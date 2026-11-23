export interface Task {
  id: string;
  title: string;
  instructions: string;
  files?: string[];
}

export interface Plan {
  summary: string;
  acceptance_criteria: string[];
  risks?: string[];
  tasks: Task[];
}

export interface ReviewIssue {
  severity: 'blocking' | 'minor';
  file: string;
  problem: string;
  suggestion: string;
}

export interface Review {
  verdict: 'approve' | 'request_changes';
  summary: string;
  issues: ReviewIssue[];
}

export const PLAN_SCHEMA = {
  type: 'object',
  required: ['summary', 'acceptance_criteria', 'tasks'],
  properties: {
    summary: { type: 'string', description: 'One paragraph: what will be built and why.' },
    acceptance_criteria: { type: 'array', items: { type: 'string' }, minItems: 1 },
    risks: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['id', 'title', 'instructions'],
        properties: {
          id: { type: 'string', description: 'Short slug, e.g. "pct-change-column"' },
          title: { type: 'string', description: 'Becomes the PR title' },
          instructions: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'request_changes'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'problem', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: ['blocking', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
};
