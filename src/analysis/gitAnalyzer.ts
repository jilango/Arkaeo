import * as path from 'path';
import { git, isGitRepo, getGitRoot } from '../utils/git';
import type { DetectedSymbol } from '../models/symbol';
import type { GitHistory, GitCommitRef, GitAuthorRef } from '../models/git';

/** Maximum number of recent commits to surface in the UI. */
const MAX_RECENT_COMMITS = 5;

/** Maximum log entries to process (guards against extremely large histories). */
const MAX_LOG_LINES = 100;

/**
 * Separator used in the git log format string.
 * Uses ASCII Unit Separator (0x1F) — safe to pass through execFile (unlike NUL
 * which is the C string terminator and gets silently truncated by the OS),
 * and will never appear in git hashes, ISO dates, author names, or commit messages.
 */
const SEP = '\x1f';

export class GitAnalyzer {
  constructor(private readonly workspaceRoot: string) {}

  async analyze(symbol: DetectedSymbol): Promise<GitHistory> {
    const empty: GitHistory = { commitCount: 0, recentCommits: [] };

    const inRepo = await isGitRepo(this.workspaceRoot);
    if (!inRepo) return empty;

    const gitRoot = await getGitRoot(this.workspaceRoot);
    if (!gitRoot) return empty;

    // git -L requires a path relative to the repo root
    const relToRepo = path.relative(gitRoot, symbol.location.filePath);

    try {
      return await this.fetchHistory(symbol, relToRepo, gitRoot);
    } catch {
      // File may be untracked, binary, or outside the repo — return empty gracefully
      return empty;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async fetchHistory(
    symbol: DetectedSymbol,
    relToRepo: string,
    gitRoot: string,
  ): Promise<GitHistory> {
    // Try line-range log first (most precise — traces the symbol through renames)
    const lineRange = `${symbol.location.startLine},${symbol.location.endLine}`;
    let logOutput: string;

    try {
      // --follow is NOT compatible with -L and causes git to hang on some versions.
      // -L already traces renames internally, so --follow is omitted here.
      logOutput = await git(
        [
          'log',
          `--max-count=${MAX_LOG_LINES}`,
          `--format=%H${SEP}%aI${SEP}%an${SEP}%ae${SEP}%s`,
          `--no-patch`,
          `-L`,
          `${lineRange}:${relToRepo}`,
        ],
        gitRoot,
      );
    } catch {
      // -L can fail on new/untracked files or when the line range moved entirely.
      // Fall back to file-level history (--follow is safe here).
      logOutput = await git(
        [
          'log',
          `--max-count=${MAX_LOG_LINES}`,
          `--format=%H${SEP}%aI${SEP}%an${SEP}%ae${SEP}%s`,
          '--follow',
          '--',
          relToRepo,
        ],
        gitRoot,
      );
    }

    if (!logOutput) {
      return { commitCount: 0, recentCommits: [] };
    }

    const commits = this.parseLog(logOutput);
    if (commits.length === 0) {
      return { commitCount: 0, recentCommits: [] };
    }

    const recentCommits = commits.slice(0, MAX_RECENT_COMMITS).map(
      (c): GitCommitRef => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author: c.author,
      }),
    );

    // Most recent = first commit in the log (git log is newest-first)
    const lastModified: GitAuthorRef = {
      hash: commits[0]!.hash,
      date: commits[0]!.date,
      author: commits[0]!.author,
    };

    // Oldest = last commit in the log
    const oldest = commits[commits.length - 1]!;
    const firstIntroduced: GitAuthorRef = {
      hash: oldest.hash,
      date: oldest.date,
      author: oldest.author,
    };

    const primaryAuthor = await this.resolvePrimaryAuthor(relToRepo, gitRoot, commits.length);

    return {
      firstIntroduced,
      lastModified,
      commitCount: commits.length,
      primaryAuthor,
      recentCommits,
    };
  }

  /**
   * Parses the NUL-separated git log output into structured commit objects.
   * Each line is: hash<SEP>date<SEP>author<SEP>email<SEP>subject
   *
   * When using `git log -L`, git also emits diff hunks between log entries.
   * We only care about the format lines, so we filter by the SEP character.
   */
  private parseLog(
    raw: string,
  ): Array<{ hash: string; date: string; author: string; email: string; message: string }> {
    const results: Array<{ hash: string; date: string; author: string; email: string; message: string }> = [];

    for (const line of raw.split('\n')) {
      if (!line.includes(SEP)) continue;
      const parts = line.split(SEP);
      if (parts.length < 5) continue;

      const [hash, date, author, email, ...msgParts] = parts;
      if (!hash || !date || !author) continue;

      results.push({
        hash: hash.trim(),
        date: date.trim(),
        author: author.trim(),
        email: (email ?? '').trim(),
        message: msgParts.join(SEP).trim(),
      });
    }

    return results;
  }

  /**
   * Uses `git shortlog` to find the author with the most commits to this file.
   * Returns undefined when the file has no history or only one commit.
   */
  private async resolvePrimaryAuthor(
    relToRepo: string,
    gitRoot: string,
    totalCommits: number,
  ): Promise<GitHistory['primaryAuthor']> {
    if (totalCommits === 0) return undefined;

    try {
      // Format: "    N\tAuthor Name <email>"
      const shortlog = await git(
        ['shortlog', '-sne', '--', relToRepo],
        gitRoot,
      );

      if (!shortlog) return undefined;

      const lines = shortlog.split('\n').filter(Boolean);
      const first = lines[0];
      if (!first) return undefined;

      const match = first.match(/^\s*(\d+)\s+(.+?)\s+<([^>]+)>/);
      if (!match) return undefined;

      const [, countStr, name, email] = match;
      const count = parseInt(countStr ?? '0', 10);
      if (!name || !email || isNaN(count)) return undefined;

      return {
        name,
        email,
        percentage: totalCommits > 0 ? count / totalCommits : 0,
      };
    } catch {
      return undefined;
    }
  }
}
