import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FACTORY_ROOT, loadConfig } from '../src/config.js';

/**
 * `npm run sync` — copies the agents, guard hook, CLAUDE.md template and CI workflows
 * into the target repo. Commit them there so every worktree (and you, in Claude Code) gets them.
 * Never overwrites an existing CLAUDE.md.
 */
const { targetRepo } = loadConfig();
if (!existsSync(join(targetRepo, '.git'))) {
  console.error(`Target repo not found at ${targetRepo}. Fix "targetRepo" in factory.config.json.`);
  process.exit(1);
}

const agentsDir = join(targetRepo, '.claude', 'agents');
mkdirSync(agentsDir, { recursive: true });
for (const f of readdirSync(resolve(FACTORY_ROOT, 'agents'))) {
  cpSync(resolve(FACTORY_ROOT, 'agents', f), join(agentsDir, f));
  console.log(`✓ .claude/agents/${f}`);
}

const templates = resolve(FACTORY_ROOT, 'templates', 'target');
const copies: [string, boolean][] = [
  ['.claude/settings.json', true],
  ['.claude/hooks/guard.mjs', true],
  ['.github/workflows/tests.yml', true],
  ['.github/workflows/claude-review.yml', true],
  ['CLAUDE.md', false],
];
for (const [file, overwrite] of copies) {
  const dest = join(targetRepo, file);
  if (!overwrite && existsSync(dest)) {
    console.log(`– ${file} exists, left untouched`);
    continue;
  }
  mkdirSync(resolve(dest, '..'), { recursive: true });
  cpSync(join(templates, file), dest);
  console.log(`✓ ${file}`);
}

console.log(`\nNow commit these in ${targetRepo} and push, so agent worktrees pick them up.`);
