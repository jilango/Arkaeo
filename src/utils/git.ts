import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Runs a git command in the given working directory and returns trimmed stdout.
 *
 * Throws if git is not installed (ENOENT) or the command exits non-zero.
 * Callers should catch and handle gracefully.
 */
export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024, // 10 MB — enough for large histories
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
