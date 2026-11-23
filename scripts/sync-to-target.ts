import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FACTORY_ROOT, loadConfig } from '../src/config.js';

/**
 * `npm run sync` — copies the agents, guard hook, CLAUDE.md template and CI workflows
 * into the target repo. Commit them there so every worktree (and you, in Claude Code) gets them.
 * Never overwrites an existing CLAUDE.md; merges into an existing .claude/settings.json.
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

// settings.json is MERGED, never overwritten: your own hooks (e.g. a Stop hook) and settings are kept.
// Any existing guard.mjs hook entry is replaced with the template's, so matcher fixes propagate.
{
  const dest = join(targetRepo, '.claude', 'settings.json');
  const template = JSON.parse(readFileSync(join(templates, '.claude', 'settings.json'), 'utf8'));
  const existing = existsSync(dest) ? JSON.parse(readFileSync(dest, 'utf8')) : {};
  const isGuard = (entry: { hooks?: { command?: string }[] }) => entry.hooks?.some((h) => h.command?.includes('guard.mjs'));
  existing.hooks ??= {};
  existing.hooks.PreToolUse = [
    ...(existing.hooks.PreToolUse ?? []).filter((e: { hooks?: { command?: string }[] }) => !isGuard(e)),
    ...template.hooks.PreToolUse,
  ];
  mkdirSync(join(targetRepo, '.claude'), { recursive: true });
  writeFileSync(dest, JSON.stringify(existing, null, 2) + '\n');
  const kept = Object.keys(existing.hooks).filter((k) => k !== 'PreToolUse');
  console.log(`✓ .claude/settings.json (merged guard hook${kept.length ? `; kept your ${kept.join(', ')} hooks` : ''})`);
}

const copies: [string, boolean][] = [
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
