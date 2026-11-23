import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Human gate: the factory stops and waits for a person. */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`\n\x1b[1m${question} [y/N]\x1b[0m `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export interface Risk {
  level: 'low' | 'high';
  reasons: string[];
}

/**
 * Risk policy: decides whether a PR may auto-merge or needs a human.
 * This is the "where does a human belong" decision, made explicit and versioned.
 */
export function assessRisk(files: string[], highRiskPaths: string[], extra: { testsPassed: boolean; approved: boolean }): Risk {
  const reasons: string[] = [];
  for (const file of files.map((f) => f.replace(/\\/g, '/'))) {
    const hit = highRiskPaths.find((p) => file === p || file.startsWith(p));
    if (hit) reasons.push(`touches ${file} (high-risk path: ${hit})`);
  }
  if (files.length > 15) reasons.push(`large change: ${files.length} files`);
  if (!extra.testsPassed) reasons.push('test suite is failing');
  if (!extra.approved) reasons.push('reviewer did not approve');
  return { level: reasons.length ? 'high' : 'low', reasons };
}
