import { readMetrics } from './metrics.js';

/** `npm run metrics` — summary of all factory runs. */
const all = readMetrics();
const tasks = all.filter((m) => m.outcome !== 'plan_rejected');
const prs = tasks.filter((m) => m.outcome === 'pr_opened');

if (!all.length) {
  console.log('No runs yet. Run: npm run factory -- <issue-number>');
  process.exit(0);
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const days = new Set(prs.map((m) => m.timestamp.slice(0, 10))).size || 1;
const reviewed = prs.filter((m) => m.firstReviewVerdict);

const rows: [string, string][] = [
  ['Issues processed', String(new Set(all.map((m) => m.issue)).size)],
  ['Plans rejected by human', String(all.filter((m) => m.outcome === 'plan_rejected').length)],
  ['Tasks attempted', String(tasks.length)],
  ['PRs opened', `${prs.length} (${pct(prs.length, tasks.length)} of tasks)`],
  ['PRs per active day', (prs.length / days).toFixed(1)],
  ['Tests green on first try', pct(prs.filter((m) => m.testsPassedFirstTry).length, prs.length)],
  ['Tests green at the end', pct(prs.filter((m) => m.testsPassedFinal).length, prs.length)],
  ['Reviewer caught issues (1st round)', pct(reviewed.filter((m) => m.firstReviewVerdict === 'request_changes').length, reviewed.length)],
  ['Final reviewer approval', pct(prs.filter((m) => m.finalReviewVerdict === 'approve').length, prs.length)],
  ['Low-risk (auto-merge eligible)', pct(prs.filter((m) => m.risk === 'low').length, prs.length)],
  ['Avg build attempts per PR', avg(prs.map((m) => m.buildAttempts)).toFixed(1)],
  ['Avg cost per PR', `$${avg(prs.map((m) => m.costUsd)).toFixed(2)}`],
  ['Avg minutes per PR', (avg(prs.map((m) => m.durationSec)) / 60).toFixed(1)],
  ['Total agent spend', `$${all.reduce((s, m) => s + m.costUsd, 0).toFixed(2)}`],
];

console.log('\n Agent factory — metrics\n');
for (const [k, v] of rows) console.log(`  ${k.padEnd(36)} ${v}`);

const failures = tasks.filter((m) => m.outcome === 'failed');
if (failures.length) {
  console.log('\n Recent failures:');
  for (const f of failures.slice(-10)) console.log(`  #${f.issue} ${f.taskTitle}: ${f.error?.split('\n')[0]}`);
}
console.log();
