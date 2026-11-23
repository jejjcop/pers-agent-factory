import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FACTORY_ROOT } from './config.js';

export const METRICS_FILE = resolve(FACTORY_ROOT, 'metrics', 'runs.jsonl');

/** One line per task. This is your evidence: throughput AND quality AND cost. */
export interface TaskMetric {
  timestamp: string;
  runId: string;
  issue: number;
  taskId: string;
  taskTitle: string;
  outcome: 'pr_opened' | 'failed' | 'plan_rejected';
  prUrl?: string;
  filesChanged: number;
  buildAttempts: number;
  testsPassedFirstTry: boolean;
  testsPassedFinal: boolean;
  firstReviewVerdict?: 'approve' | 'request_changes';
  finalReviewVerdict?: 'approve' | 'request_changes';
  reviewBlockingIssues: number;
  risk?: 'low' | 'high';
  riskReasons?: string[];
  autoMerged: boolean;
  costUsd: number;
  durationSec: number;
  error?: string;
}

export function recordMetric(m: TaskMetric): void {
  appendFileSync(METRICS_FILE, JSON.stringify(m) + '\n');
}

export function readMetrics(): TaskMetric[] {
  if (!existsSync(METRICS_FILE)) return [];
  return readFileSync(METRICS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
