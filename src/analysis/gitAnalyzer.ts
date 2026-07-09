import * as path from 'path';
import { git, isGitRepo, getGitRoot } from '../utils/git';
import type { DetectedSymbol } from '../models/symbol';
import type { GitHistory, GitCommitRef, GitAuthorRef, CoChangeRef } from '../models/git';

/** Maximum number of recent commits to surface in the UI. */
const MAX_RECENT_COMMITS = 5;

/** Maximum log entries to process (guards against extremely large histories). */
const MAX_LOG_LINES = 100;

/** Maximum co-changed files to return. */
const MAX_COCHANGE = 8;

/** Maximum commits to scan for co-change coupling (diff-tree per commit). */
const MAX_COCHANGE_COMMITS = 30;

/**
 * Separator used in the git log format string.
 * Uses ASCII Unit Separator (0x1F) — safe to pass through execFile (unlike NUL
 * which is the C string terminator and gets silently truncated by the OS),
 * and will never appear in git hashes, ISO dates, author names, or commit messages.
 */
const SEP = '\x1f';

export class GitAnalyzer {
  constructor(private readonly workspaceRoot: string) {}

  async analyze(symbol: DetectedSymbol, signal?: AbortSignal): Promise<GitHistory> {
    const empty: GitHistory = { commitCount: 0, recentCommits: [] };

    const inRepo = await isGitRepo(this.workspaceRoot);
    if (!inRepo || signal?.aborted) return empty;

    const gitRoot = await getGitRoot(this.workspaceRoot);
    if (!gitRoot || signal?.aborted) return empty;

    // git -L requires a path relative to the repo root
    const relToRepo = path.relative(gitRoot, symbol.location.filePath);

    try {
      return await this.fetchHistory(symbol, relToRepo, gitRoot, signal);
    } catch {
      // File may be untracked, binary, outside the repo, or cancelled — return empty
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
    signal?: AbortSignal,
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
        signal,
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
        signal,
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

    const [primaryAuthor, coChangedWith] = await Promise.all([
      this.resolvePrimaryAuthor(relToRepo, gitRoot, commits.length, signal),
      this.fetchCoChanges(commits.map((c) => c.hash), relToRepo, gitRoot, signal),
    ]);

    return {
      firstIntroduced,
      lastModified,
      commitCount: commits.length,
      primaryAuthor,
      recentCommits,
      coChangedWith,
    };
  }

  /**
   * For each commit touching the symbol, lists all files in that commit via
   * `git diff-tree` and counts how often other files appear alongside the target.
   */
  private async fetchCoChanges(
    commitHashes: string[],
    relToRepo: string,
    gitRoot: string,
    signal?: AbortSignal,
  ): Promise<CoChangeRef[]> {
    const hashes = commitHashes.slice(0, MAX_COCHANGE_COMMITS);
    const fileLists: string[][] = [];

    for (const hash of hashes) {
      if (signal?.aborted) break;
      try {
        const output = await git(
          ['diff-tree', '--no-commit-id', '--name-only', '-r', hash],
          gitRoot,
          signal,
        );
        if (!output) continue;
        fileLists.push(
          output.split('\n').map((line) => line.trim()).filter(Boolean),
        );
      } catch {
        continue;
      }
    }

    return this.aggregateCoChanges(fileLists, relToRepo, gitRoot);
  }

  /**
   * Aggregates per-commit file lists into co-change frequency counts.
   */
  aggregateCoChanges(
    commitFileLists: string[][],
    relToRepo: string,
    gitRoot: string,
  ): CoChangeRef[] {
    const normalizedTarget = relToRepo.replace(/\\/g, '/');
    const counts = new Map<string, number>();

    for (const files of commitFileLists) {
      const normalized = files.map((f) => f.replace(/\\/g, '/'));
      const touchesTarget = normalized.some((f) => f === normalizedTarget);
      if (!touchesTarget) continue;

      for (const file of normalized) {
        if (file === normalizedTarget) continue;
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_COCHANGE);

    return sorted.map(([relPath, count]) => ({
      filePath: path.resolve(gitRoot, relPath),
      relativePath: relPath,
      count,
    }));
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
    signal?: AbortSignal,
  ): Promise<GitHistory['primaryAuthor']> {
    if (totalCommits === 0) return undefined;

    try {
      // Format: "    N\tAuthor Name <email>"
      const shortlog = await git(
        ['shortlog', '-sne', '--', relToRepo],
        gitRoot,
        signal,
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
