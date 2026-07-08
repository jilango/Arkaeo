import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Runs a git command in the given working directory and returns trimmed stdout.
 *
 * @param args   - Arguments passed to git.
 * @param cwd    - Working directory (any path inside the repo is fine).
 * @param signal - Optional AbortSignal; if triggered the spawned process is killed.
 *
 * Throws if git is not installed (ENOENT), exits non-zero, or is aborted.
 */
export async function git(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15_000,
    signal,
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return stdout.trim();
}

/**
 * Returns true if git is available in PATH and the given directory is inside
 * a git repository. Safe to call without throwing.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the root of the git repository containing the given path,
 * or undefined if not in a repo.
 */
export async function getGitRoot(cwd: string): Promise<string | undefined> {
  try {
    const root = await git(['rev-parse', '--show-toplevel'], cwd);
    return root || undefined;
  } catch {
    return undefined;
  }
}
