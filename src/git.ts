import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);
const pExec = promisify(exec);
const BUFFER = 50 * 1024 * 1024;

/** Run a program with argument array (no shell quoting problems, works on Windows). */
export async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await pExecFile(cmd, args, { cwd, maxBuffer: BUFFER });
  return stdout.trim();
}

/** Run a shell command and never throw: returns pass/fail plus all output (used for tests). */
export async function shell(command: string, cwd: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await pExec(command, { cwd, maxBuffer: BUFFER });
    return { ok: true, output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` || String(e.message) };
  }
}

/** Each task gets its own worktree + branch, so parallel agents never touch each other's files. */
export async function createWorktree(repo: string, dir: string, branch: string, base: string): Promise<void> {
  await run('git', ['fetch', 'origin', base], repo).catch(() => undefined);
  try {
    await run('git', ['worktree', 'add', '-B', branch, dir, `origin/${base}`], repo);
  } catch {
    await run('git', ['worktree', 'add', '-B', branch, dir, base], repo);
  }
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  await run('git', ['worktree', 'remove', '--force', dir], repo);
}

/** Stage everything, commit, and return the list of changed files. */
export async function commitAll(cwd: string, message: string): Promise<string[]> {
  await run('git', ['add', '-A'], cwd);
  const files = (await run('git', ['diff', '--cached', '--name-only'], cwd)).split('\n').filter(Boolean);
  if (files.length) await run('git', ['commit', '-m', message], cwd);
  return files;
}
