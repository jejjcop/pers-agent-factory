import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type Role = 'planner' | 'builder' | 'tester' | 'reviewer';

export interface FactoryConfig {
  targetRepo: string;
  baseBranch: string;
  worktreeDir: string;
  setupCommand?: string;
  testCommand: string;
  maxParallel: number;
  maxBuildAttempts: number;
  maxReviewRounds: number;
  maxBudgetUsdPerAgent: number;
  autoMergeLowRisk: boolean;
  highRiskPaths: string[];
  models: Record<Role, string>;
}

export function loadConfig(): FactoryConfig {
  const raw = JSON.parse(readFileSync(resolve(FACTORY_ROOT, 'factory.config.json'), 'utf8'));
  return {
    ...raw,
    // Paths in the config are relative to the factory folder.
    targetRepo: resolve(FACTORY_ROOT, raw.targetRepo),
    worktreeDir: resolve(FACTORY_ROOT, raw.worktreeDir),
  };
}
