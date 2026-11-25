import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAgent } from './agents.js';
import { FACTORY_ROOT, loadConfig, type FactoryConfig } from './config.js';
import { assessRisk, confirm } from './gates.js';
import { changedSinceStaged, commitAll, createWorktree, removeWorktree, restoreFromIndex, shell, stageAll, unstageAll } from './git.js';
import { enableAutoMerge, ensureLabels, getIssue, openPr, type Issue } from './github.js';
import { log, tail } from './log.js';
import { recordMetric, type TaskMetric } from './metrics.js';
import { builderPrompt, documenterPrompt, formatReview, plannerPrompt, prBody, reviewerPrompt, taskContext, testerPrompt } from './prompts.js';
import { PLAN_SCHEMA, REVIEW_SCHEMA, type Plan, type Review, type Task } from './schemas.js';

/**
 * The whole factory:
 *   issue → PLANNER → [human gate] → per task, in parallel worktrees:
 *     BUILDER → TESTER → run tests ⟲ BUILDER fixes → DOCUMENTER → REVIEWER ⟲ BUILDER fixes → PR → [risk gate] → auto-merge or human
 */
export async function runIssue(issueNumber: number, flags: { yes: boolean }): Promise<void> {
  const cfg = loadConfig();
  const runId = `issue-${issueNumber}-${Date.now()}`;
  const issue = await getIssue(issueNumber, cfg.targetRepo);
  log('factory', `Issue #${issue.number}: ${issue.title}`);
  await ensureLabels(cfg.targetRepo);

  // 1. PLAN
  const planned = await runAgent<Plan>('planner', plannerPrompt(issue), {
    cwd: cfg.targetRepo,
    model: cfg.models.planner,
    maxBudgetUsd: cfg.maxBudgetUsdPerAgent,
    schema: PLAN_SCHEMA,
    label: 'planner',
  });
  if (!planned.ok || !planned.data) throw new Error(`Planner failed: ${planned.error ?? 'no plan returned'}`);
  const plan = planned.data;
  writeFileSync(resolve(FACTORY_ROOT, 'plans', `${runId}.json`), JSON.stringify(plan, null, 2));
  printPlan(plan);

  // 2. HUMAN GATE — a person approves the plan before any code is written.
  if (!flags.yes && !(await confirm(`Approve this plan and start ${plan.tasks.length} builder(s)?`))) {
    log('factory', 'Plan rejected. Edit the issue and run again.');
    recordMetric(emptyMetric(runId, issue, { id: '-', title: 'plan', instructions: '' }, 'plan_rejected', planned.costUsd));
    return;
  }

  // 3. SWARM — one pipeline per task, up to maxParallel at once.
  const results = await mapLimit(plan.tasks, cfg.maxParallel, (task) => runTask(cfg, runId, issue, plan, task));

  // The planner's cost is shared across tasks so cost-per-PR stays honest.
  const planShare = planned.costUsd / plan.tasks.length;
  for (const m of results) {
    m.costUsd += planShare;
    recordMetric(m);
  }

  console.log('\n── Summary ─────────────────────────────');
  for (const m of results) {
    const icon = m.outcome === 'pr_opened' ? (m.risk === 'low' ? '🟢' : '🔴') : '💥';
    console.log(`${icon} ${m.taskTitle}\n   ${m.prUrl ?? m.error}\n   attempts ${m.buildAttempts} · $${m.costUsd.toFixed(2)} · ${m.durationSec}s`);
  }
}

async function runTask(cfg: FactoryConfig, runId: string, issue: Issue, plan: Plan, task: Task): Promise<TaskMetric> {
  const started = Date.now();
  const slug = task.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40);
  const branch = `agent/issue-${issue.number}-${slug}`;
  const dir = join(cfg.worktreeDir, `issue-${issue.number}-${slug}`);
  const tag = slug;
  const metric = emptyMetric(runId, issue, task, 'failed', 0);
  const agentOpts = (role: keyof FactoryConfig['models'], schema?: Record<string, unknown>) => ({
    cwd: dir,
    model: cfg.models[role],
    maxBudgetUsd: cfg.maxBudgetUsdPerAgent,
    schema,
    label: `${tag}/${role}`,
  });

  try {
    await createWorktree(cfg.targetRepo, dir, branch, cfg.baseBranch);
    log(tag, `worktree ready on ${branch}`);
    if (cfg.setupCommand) {
      const setup = await shell(cfg.setupCommand, dir);
      if (!setup.ok) throw new Error(`setup failed:\n${tail(setup.output, 1500)}`);
    }

    const context = taskContext(issue, plan, task);
    const build = async (feedback?: string) => {
      metric.buildAttempts++;
      metric.costUsd += (await runAgent('builder', builderPrompt(context, feedback), agentOpts('builder'))).costUsd;
    };
    const runTests = async () => {
      const r = await shell(cfg.testCommand, dir);
      log(tag, `tests ${r.ok ? 'PASS ✅' : 'FAIL ❌'}`);
      return r;
    };
    // The documenter may only touch docs. Anything else it changes is put back, so the
    // reviewer never sees code that skipped the tests.
    const document = async () => {
      await stageAll(dir);
      try {
        metric.costUsd += (await runAgent('documenter', documenterPrompt(context), agentOpts('documenter'))).costUsd;
        const { changed, added } = await changedSinceStaged(dir);
        const changedCode = changed.filter((f) => !isDocFile(f));
        const addedCode = added.filter((f) => !isDocFile(f));
        await restoreFromIndex(dir, changedCode);
        for (const f of addedCode) rmSync(join(dir, f), { force: true });
        if (changedCode.length || addedCode.length) {
          log(tag, `documenter touched non-doc files, reverted: ${[...changedCode, ...addedCode].join(', ')}`);
        }
      } finally {
        await unstageAll(dir);
      }
    };

    // BUILD, then an independent TESTER tries to break it.
    await build();
    metric.costUsd += (await runAgent('tester', testerPrompt(context), agentOpts('tester'))).costUsd;
    let tests = await runTests();
    metric.testsPassedFirstTry = tests.ok;

    // FIX LOOP: failing tests go straight back to the builder.
    while (!tests.ok && metric.buildAttempts < cfg.maxBuildAttempts) {
      await build(`The test suite fails. Fix the cause.\n\n\`\`\`\n${tail(tests.output)}\n\`\`\``);
      tests = await runTests();
    }

    // DOCS: once the code works, bring the docs in line so the reviewer checks both together.
    if (tests.ok) await document();

    // REVIEW LOOP: reviewer gates, builder fixes blocking issues.
    let review: Review | undefined;
    if (tests.ok) {
      for (let round = 1; round <= cfg.maxReviewRounds; round++) {
        const r = await runAgent<Review>('reviewer', reviewerPrompt(context, cfg.baseBranch), agentOpts('reviewer', REVIEW_SCHEMA));
        metric.costUsd += r.costUsd;
        review = r.data;
        if (!review) break;
        metric.firstReviewVerdict ??= review.verdict;
        metric.reviewBlockingIssues += review.issues.filter((i) => i.severity === 'blocking').length;
        log(tag, `review: ${review.verdict}`);
        if (review.verdict === 'approve' || round === cfg.maxReviewRounds) break;
        await build(`A senior reviewer requested changes:\n${formatReview(review)}`);
        tests = await runTests();
        if (!tests.ok) break;
        // The fix may have changed behaviour the docs describe.
        await document();
      }
    }

    // SHIP: commit, open PR, apply the risk policy.
    const files = await commitAll(dir, `${task.title} (#${issue.number})\n\nAgent factory run ${runId}`);
    if (!files.length) throw new Error('builder produced no changes');
    const approved = review?.verdict === 'approve';
    const risk = assessRisk(files, cfg.highRiskPaths, { testsPassed: tests.ok, approved });

    const prUrl = await openPr(dir, {
      branch,
      base: cfg.baseBranch,
      title: task.title,
      body: prBody({ issue, plan, task, testsPassed: tests.ok, review, riskReasons: risk.reasons, buildAttempts: metric.buildAttempts, costUsd: metric.costUsd }),
      labels: ['agent-pr', risk.level === 'low' ? 'low-risk' : 'needs-human'],
      draft: !tests.ok,
    });
    log(tag, `PR opened: ${prUrl}`);

    const autoMerged = cfg.autoMergeLowRisk && risk.level === 'low' ? await enableAutoMerge(prUrl, dir) : false;
    if (autoMerged) log(tag, 'auto-merge enabled (merges when CI is green)');

    Object.assign(metric, {
      outcome: 'pr_opened',
      prUrl,
      filesChanged: files.length,
      testsPassedFinal: tests.ok,
      finalReviewVerdict: review?.verdict,
      risk: risk.level,
      riskReasons: risk.reasons,
      autoMerged,
    });
  } catch (err) {
    metric.error = err instanceof Error ? err.message : String(err);
    log(tag, `💥 ${metric.error.split('\n')[0]}`);
  } finally {
    metric.durationSec = Math.round((Date.now() - started) / 1000);
    await removeWorktree(cfg.targetRepo, dir).catch(() => undefined);
  }
  return metric;
}

function emptyMetric(runId: string, issue: Issue, task: Task, outcome: TaskMetric['outcome'], costUsd: number): TaskMetric {
  return {
    timestamp: new Date().toISOString(),
    runId,
    issue: issue.number,
    taskId: task.id,
    taskTitle: task.title,
    outcome,
    filesChanged: 0,
    buildAttempts: 0,
    testsPassedFirstTry: false,
    testsPassedFinal: false,
    reviewBlockingIssues: 0,
    autoMerged: false,
    costUsd,
    durationSec: 0,
  };
}

function printPlan(plan: Plan): void {
  console.log(`\n── Plan ────────────────────────────────\n${plan.summary}\n`);
  console.log('Acceptance criteria:');
  plan.acceptance_criteria.forEach((c) => console.log(`  ✓ ${c}`));
  if (plan.risks?.length) {
    console.log('Risks:');
    plan.risks.forEach((r) => console.log(`  ⚠ ${r}`));
  }
  console.log('Tasks (run in parallel):');
  plan.tasks.forEach((t, i) => console.log(`  ${i + 1}. [${t.id}] ${t.title}\n     ${t.instructions.replace(/\n/g, '\n     ')}`));
}

/** What the documenter may change: Markdown and docs/, but not CLAUDE.md or the agents' own config. */
export function isDocFile(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  if (/^\.(claude|github)\//.test(p) || /(^|\/)CLAUDE\.md$/i.test(p)) return false;
  return /\.md$/i.test(p) || p.startsWith('docs/');
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
