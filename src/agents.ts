import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FACTORY_ROOT, type Role } from './config.js';
import { log } from './log.js';

interface AgentDef {
  role: Role;
  tools: string[];
  instructions: string;
}

/** Agents live in agents/*.md — same format as Claude Code subagents, so you can also use them by hand. */
export function loadAgent(role: Role): AgentDef {
  const text = readFileSync(resolve(FACTORY_ROOT, 'agents', `${role}.md`), 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`agents/${role}.md has no frontmatter`);
  const frontmatter = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .filter((line) => line.includes(':'))
      .map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]),
  );
  return {
    role,
    tools: (frontmatter.tools ?? '').split(',').map((t: string) => t.trim()).filter(Boolean),
    instructions: match[2].trim(),
  };
}

export interface AgentResult<T> {
  ok: boolean;
  text: string;
  data?: T;
  costUsd: number;
  turns: number;
  error?: string;
}

export interface RunOptions {
  cwd: string;
  model: string;
  maxBudgetUsd: number;
  /** JSON schema: forces the agent to return structured output (used by planner and reviewer). */
  schema?: Record<string, unknown>;
  /** Prefix for live log lines, e.g. "task-2/builder". */
  label: string;
}

const READ_ONLY: Role[] = ['planner', 'reviewer'];

export async function runAgent<T = unknown>(role: Role, prompt: string, opts: RunOptions): Promise<AgentResult<T>> {
  const def = loadAgent(role);
  const readOnly = READ_ONLY.includes(role);
  let result: AgentResult<T> = { ok: false, text: '', costUsd: 0, turns: 0, error: 'agent produced no result' };

  log(opts.label, `started (${opts.model})`);

  for await (const msg of query({
    prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      // Keep Claude Code's built-in tool know-how, then add the role's instructions.
      systemPrompt: { type: 'preset', preset: 'claude_code', append: def.instructions },
      // Only the tools in the agent's frontmatter are auto-approved; everything else is denied.
      allowedTools: def.tools,
      disallowedTools: readOnly ? ['Edit', 'Write', 'NotebookEdit'] : [],
      permissionMode: readOnly ? 'default' : 'acceptEdits',
      // Loads the target repo's CLAUDE.md and .claude/settings.json (where the guard hook lives).
      settingSources: ['project'],
      maxBudgetUsd: opts.maxBudgetUsd,
      maxTurns: 80,
      ...(opts.schema ? { outputFormat: { type: 'json_schema' as const, schema: opts.schema } } : {}),
    },
  })) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') log(opts.label, describeToolUse(block.name, block.input));
      }
    }
    if (msg.type === 'result') {
      result =
        msg.subtype === 'success'
          ? { ok: !msg.is_error, text: msg.result, data: msg.structured_output as T, costUsd: msg.total_cost_usd, turns: msg.num_turns }
          : { ok: false, text: '', costUsd: msg.total_cost_usd, turns: msg.num_turns, error: msg.subtype };
    }
  }

  log(opts.label, `${result.ok ? 'done' : `FAILED (${result.error})`} · ${result.turns} turns · $${result.costUsd.toFixed(3)}`);
  return result;
}

function describeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const detail = i.file_path ?? i.command ?? i.pattern ?? '';
  return `${name} ${String(detail).slice(0, 100)}`;
}
