# Agent Factory

A fleet of AI agents that **plan, build, test, review and ship** pull requests end to end, with humans placed at explicit gates.

```
GitHub issue
   │
   ▼
PLANNER (read-only) ── plan + acceptance criteria + independent tasks
   │
   ▼
🧑 HUMAN GATE: approve plan
   │
   ├──────────────┬──────────────┐        ← swarm: one git worktree per task, run in parallel
   ▼              ▼              ▼
BUILDER        BUILDER        BUILDER     writes code + tests
   ▼              ▼              ▼
TESTER         TESTER         TESTER      independent agent, tries to break it
   ▼              ▼              ▼
run tests ⟲ builder fixes (max N attempts)
   ▼
REVIEWER (read-only, structured verdict) ⟲ builder fixes blocking issues
   ▼
PR opened ─► RISK POLICY ─► 🟢 low-risk: auto-merge when CI green
                         └► 🔴 high-risk: label needs-human
   ▼
metrics/runs.jsonl ─► npm run metrics
```

## Layout

```
agent-factory/                 ← this repo (TypeScript, Claude Agent SDK)
├── agents/                    planner / builder / tester / reviewer: role prompts + allowed tools
├── src/pipeline.ts            the orchestration (read this first)
├── src/gates.ts               human gate + risk policy ("where does a human belong")
├── src/agents.ts              runs one agent via the SDK, logs tool calls, tracks cost
├── src/report.ts              metrics summary
├── factory.config.json        target repo, test command, parallelism, budgets, high-risk paths
├── templates/target/          copied into the stock app by `npm run sync`
│   ├── .claude/settings.json  registers the guard hook
│   ├── .claude/hooks/guard.mjs  blocks secrets, git push, DB wipes, CI edits
│   ├── .github/workflows/     tests + independent Claude review in CI
│   └── CLAUDE.md              conventions every agent reads (edit this!)
└── docs/LEARNING-LOG.md       what you learned: this is your interview
```

## Setup (≈15 min)

**Prerequisites:** Node 20+, Git, PHP + Composer, [GitHub CLI](https://cli.github.com) (`gh auth login`), an Anthropic API key.

1. Put this folder **next to** your stock app, e.g. `C:\dev\agent-factory` and `C:\dev\stock-app`, or adjust `targetRepo` in `factory.config.json`.
2. Check that the stock app is on GitHub and that `php artisan test` passes on `main`.
3. Install and set the key:
   ```bash
   npm install
   # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
   # bash/zsh:   export ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Copy the agents, guard hook and CI into the stock app, then commit there:
   ```bash
   npm run sync
   cd ../stock-app && git add .claude .github CLAUDE.md && git commit -m "Add agent factory config" && git push
   ```
5. **Edit `CLAUDE.md` in the stock app.** Ten minutes here saves hours of bad agent output.

Spend is capped by `maxBudgetUsdPerAgent` (default $2 per agent call). A typical small task costs well under that.

## Run it

```bash
npm run factory -- 12        # build issue #12
npm run metrics              # see how the factory is performing
```

## 4-week plan

| Week | Goal | Done when |
|---|---|---|
| **1. By hand** | Learn each role. In the stock app run `claude`, then e.g. *"Use the planner subagent to plan issue #3"*, then builder, tester, reviewer. Tune `agents/*.md` and `CLAUDE.md`. | You've shipped 3 issues manually through all 4 roles and rewritten each prompt at least once. |
| **2. Automate** | Run `npm run factory`. Start with `maxParallel: 1`, then 3. Watch the logs and fix what breaks. | 10+ PRs opened by the factory. |
| **3. CI + gates** | Enable branch protection (require `tests`), add the `ANTHROPIC_API_KEY` secret, turn on auto-merge in repo settings, set `autoMergeLowRisk: true`. Tune `highRiskPaths`. | Low-risk PRs merge with no human touch; risky ones never do. |
| **4. Evidence** | Run 20–30 issues. Write `docs/LEARNING-LOG.md`. Build a small dashboard page on `metrics/runs.jsonl` if time allows. | You can present your numbers and failures in 45 min. |

## Good first issues for the stock app

Create these on GitHub. Small and testable is what agents are good at:
- Show % change since purchase next to each holding, rounded to 2 decimals
- Validate that a transaction's purchase date can't be in the future
- CSV export of all transactions
- Show total portfolio value and day change on the dashboard
- Empty state on the holdings page when there are no holdings
- An issue with **two independent parts**, to see the swarm run in parallel

## Ideas to extend (and talk about in the interview)

- **Evals:** a fixed set of 10 "golden" issues with known-good solutions; rerun after every prompt change and compare pass rate and cost. This is how you know a prompt change made things *better*.
- **Model routing:** a cheap model for simple tasks, a stronger one when attempts > 1.
- **Planner learns from failures:** feed the last 5 failure reasons from `runs.jsonl` into the planner prompt.
- **Issue → PR via GitHub Actions** instead of your laptop, triggered by an `agent` label.
