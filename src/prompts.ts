import type { Issue } from './github.js';
import type { Plan, Review, Task } from './schemas.js';

export function plannerPrompt(issue: Issue): string {
  return `Plan the work for GitHub issue #${issue.number}.

Title: ${issue.title}

${issue.body || '(no description)'}`;
}

/** Shared context every downstream agent gets. They never see each other's reasoning, only this. */
export function taskContext(issue: Issue, plan: Plan, task: Task): string {
  return `## Issue #${issue.number}: ${issue.title}
${plan.summary}

## Acceptance criteria (for the whole issue)
${plan.acceptance_criteria.map((c) => `- ${c}`).join('\n')}

## YOUR task: ${task.title} (id: ${task.id})
${task.instructions}
${task.files?.length ? `\nLikely files: ${task.files.join(', ')}` : ''}`;
}

export function builderPrompt(context: string, feedback?: string): string {
  return feedback
    ? `${context}\n\n## Feedback on your previous attempt — fix this\n${feedback}`
    : `${context}\n\nImplement this task now.`;
}

export function testerPrompt(context: string): string {
  return `${context}\n\nA builder has implemented this task (see git diff). Write tests that try to break it.`;
}

export function documenterPrompt(context: string): string {
  return `${context}\n\nA builder has implemented this task and the tests pass (see git diff). Update the project's documentation to match the change, or report that none is needed.`;
}

export function reviewerPrompt(context: string, baseBranch: string): string {
  return `${context}\n\nReview the uncommitted changes in this worktree (\`git diff\`, \`git status\`, and new files), code and documentation. The base branch is ${baseBranch}.`;
}

export function formatReview(review: Review): string {
  const lines = review.issues.map((i) => `- [${i.severity}] ${i.file}: ${i.problem} → ${i.suggestion}`);
  return `${review.summary}\n${lines.join('\n')}`;
}

export function prBody(o: {
  issue: Issue;
  plan: Plan;
  task: Task;
  testsPassed: boolean;
  review?: Review;
  riskReasons: string[];
  buildAttempts: number;
  costUsd: number;
}): string {
  return `Part of #${o.issue.number} — built by the agent factory.

### Task
${o.task.instructions}

### Acceptance criteria
${o.plan.acceptance_criteria.map((c) => `- [ ] ${c}`).join('\n')}

### Pipeline result
| Check | Result |
|---|---|
| Tests | ${o.testsPassed ? '✅ passing' : '❌ failing'} |
| Reviewer | ${o.review ? (o.review.verdict === 'approve' ? '✅ approved' : '⚠️ changes requested') : '— not reached'} |
| Build attempts | ${o.buildAttempts} |
| Agent cost | $${o.costUsd.toFixed(2)} |
| Risk | ${o.riskReasons.length ? `🔴 needs human:\n${o.riskReasons.map((r) => `- ${r}`).join('<br>')}` : '🟢 low'} |

${o.review ? `### Review summary\n${formatReview(o.review)}` : ''}
`;
}
