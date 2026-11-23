import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './git.js';

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export async function getIssue(n: number, repo: string): Promise<Issue> {
  return JSON.parse(await run('gh', ['issue', 'view', String(n), '--json', 'number,title,body,url'], repo));
}

const LABELS: Record<string, string> = {
  'agent-pr': '6f42c1',
  'low-risk': '2da44e',
  'needs-human': 'd73a4a',
};

export async function ensureLabels(repo: string): Promise<void> {
  for (const [name, color] of Object.entries(LABELS)) {
    await run('gh', ['label', 'create', name, '--color', color, '--force'], repo);
  }
}

export async function openPr(
  cwd: string,
  pr: { branch: string; base: string; title: string; body: string; labels: string[]; draft: boolean },
): Promise<string> {
  await run('git', ['push', '-u', '--force-with-lease', 'origin', pr.branch], cwd);
  const bodyFile = join(tmpdir(), `factory-pr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(bodyFile, pr.body);
  try {
    const args = ['pr', 'create', '--base', pr.base, '--head', pr.branch, '--title', pr.title, '--body-file', bodyFile];
    for (const label of pr.labels) args.push('--label', label);
    if (pr.draft) args.push('--draft');
    return (await run('gh', args, cwd)).split('\n').pop() ?? '';
  } finally {
    unlinkSync(bodyFile);
  }
}

/** Requires "Allow auto-merge" in the repo settings. Merges once CI goes green. */
export async function enableAutoMerge(prUrl: string, cwd: string): Promise<boolean> {
  try {
    await run('gh', ['pr', 'merge', prUrl, '--squash', '--auto'], cwd);
    return true;
  } catch {
    return false;
  }
}
