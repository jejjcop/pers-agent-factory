# Agent Factory

An orchestrator that turns GitHub issues into reviewed, tested pull requests using a team of specialised AI agents, with humans placed at explicit, configurable gates.

Built on the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) in TypeScript.

## How it works

```
GitHub issue
   │
   ▼
PLANNER (read-only) ── plan + acceptance criteria + independent tasks
   │
   ▼
🧑 HUMAN GATE: approve plan
   │
   ├──────────────┬──────────────┐        ← one isolated git worktree per task, run in parallel
   ▼              ▼              ▼
BUILDER        BUILDER        BUILDER     implements the task, with tests
   ▼              ▼              ▼
TESTER         TESTER         TESTER      independent agent, writes tests that try to break it
   ▼              ▼              ▼
run test suite ⟲ builder fixes failures (max N attempts)
   ▼
DOCUMENTER     updates README / docs / CHANGELOG to match the change
   ▼
REVIEWER (read-only, structured verdict) ⟲ builder fixes blocking issues, documenter re-runs
   ▼
PR opened ─► RISK POLICY ─► 🟢 low risk:  auto-merge when CI is green (opt-in)
                         └► 🔴 high risk: labelled needs-human
   ▼
metrics/runs.jsonl ─► npm run metrics
```

### Agents

| Agent | Role | Can edit files |
|---|---|---|
| **Planner** | Turns an issue into a small plan with acceptance criteria, split into tasks that can be built in parallel. | No |
| **Builder** | Implements exactly one task, with tests, in its own worktree. | Yes |
| **Tester** | Writes adversarial tests against the acceptance criteria. Never changes application code. | Tests only |
| **Documenter** | Brings the project's documentation in line with the change. Non-doc edits are reverted by the orchestrator. | Docs only |
| **Reviewer** | Reviews the diff for correctness, security and maintainability; returns `approve` or `request_changes`. | No |

Each agent is a Markdown file in [`agents/`](agents/) using the Claude Code subagent format, so the same definitions run in the automated pipeline and interactively in Claude Code.

### Safety and control

- **Human gates.** A person approves every plan before code is written. PRs touching high-risk paths, failing tests or lacking reviewer approval are never auto-merged.
- **Risk policy as code.** [`src/gates.ts`](src/gates.ts) decides which PRs can merge unattended, based on `highRiskPaths`, change size, test results and the review verdict.
- **Guard hook.** A `PreToolUse` hook installed in the target repo blocks agents from touching secrets, git internals, CI config and the guardrails themselves, and from running destructive commands (`git push`, hard resets, database wipes, piping downloads into a shell).
- **Isolation.** Every task runs in a fresh git worktree. Agents never commit or push; the orchestrator does.
- **Budgets.** Each agent call is capped by `maxBudgetUsdPerAgent`, and every run is logged with its cost.

## Requirements

- Node.js 20+
- Git and the [GitHub CLI](https://cli.github.com) (`gh auth login`)
- An Anthropic API key
- A target repository on GitHub with a working test command

The included configuration and CI templates target a Laravel (PHP) application with PHPUnit and Playwright tests. Other stacks work by changing `setupCommand`, `testCommand` and the templates.

## Getting started

1. **Install**

   ```bash
   npm install
   export ANTHROPIC_API_KEY=sk-ant-...        # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
   ```

2. **Point it at your repository** by editing [`factory.config.json`](factory.config.json) (see [Configuration](#configuration)).

3. **Install the agents and guard hook in the target repo**, then commit them there so every worktree picks them up:

   ```bash
   npm run sync
   cd <target-repo> && git add .claude CLAUDE.md && git commit -m "Add agent factory config"
   ```

   `sync` never overwrites an existing `CLAUDE.md`, and merges into an existing `.claude/settings.json` rather than replacing it.

4. **Describe your conventions in the target repo's `CLAUDE.md`.** Every agent reads it; it has the largest effect on output quality.

## Usage

```bash
npm run factory -- 12          # plan and build issue #12, with plan approval
npm run factory -- 12 --yes    # skip the plan-approval gate
npm run metrics                # summary of all runs
npm run typecheck
```

The agents can also be used by hand: in the target repo run `claude` and ask, for example, *"Use the planner subagent to plan issue #3"*.

## Configuration

All settings live in [`factory.config.json`](factory.config.json). Paths are relative to this repository.

| Key | Description |
|---|---|
| `targetRepo` | Path to the repository the factory works on. |
| `baseBranch` | Branch that worktrees start from and PRs target. |
| `worktreeDir` | Where task worktrees are created. |
| `setupCommand` | Run once in each new worktree (install dependencies, prepare `.env`). |
| `testCommand` | Full test suite; its exit code decides pass or fail. |
| `maxParallel` | Number of tasks built at the same time. |
| `maxBuildAttempts` | Builder attempts per task before giving up on failing tests. |
| `maxReviewRounds` | Reviewer → builder rounds before the PR is opened anyway. |
| `maxBudgetUsdPerAgent` | Spend cap for a single agent call. |
| `autoMergeLowRisk` | Enable GitHub auto-merge on low-risk PRs. Off by default. |
| `highRiskPaths` | Path prefixes that always require a human review. |
| `models` | Model per agent role. |

To auto-merge low-risk PRs, also enable branch protection with a required `tests` check and allow auto-merge in the target repository's settings.

### CI templates

[`templates/target/.github/workflows/`](templates/target/.github/workflows/) contains optional workflows for the target repo: a test job and an independent Claude review on every PR (requires an `ANTHROPIC_API_KEY` repository secret). They are not copied by `sync`; add them to the target repo yourself if you want them.

## Metrics

Every task appends a record to `metrics/runs.jsonl`: outcome, build attempts, test and review results, risk level, cost and duration. `npm run metrics` summarises them, including first-try test pass rate, reviewer catch rate, share of auto-merge-eligible PRs, average cost and time per PR, and the most recent failures.

## Project structure

```
├── agents/                      agent definitions: role prompt + allowed tools
├── src/
│   ├── index.ts                 CLI entry point
│   ├── pipeline.ts              orchestration: plan → build → test → document → review → PR
│   ├── agents.ts                runs one agent via the SDK, logs tool calls, tracks cost
│   ├── prompts.ts               prompts and PR body
│   ├── schemas.ts               structured output for planner and reviewer
│   ├── gates.ts                 human gate and risk policy
│   ├── git.ts / github.ts       worktrees, commits, PRs, labels
│   ├── metrics.ts / report.ts   run records and summary
│   └── config.ts                configuration loading
├── scripts/sync-to-target.ts    installs agents and guard hook in the target repo
├── templates/target/            files for the target repo (.claude/, CLAUDE.md, CI workflows)
└── factory.config.json
```

## Roadmap

- **Evals:** a fixed set of reference issues with known-good solutions, re-run after every prompt change to compare pass rate and cost.
- **Model routing:** a cheaper model for simple tasks, escalating to a stronger one after a failed attempt.
- **Learning from failures:** feed recent failure reasons from `runs.jsonl` into the planner prompt.
- **Run in GitHub Actions:** trigger the pipeline from an `agent` label instead of a local machine.
