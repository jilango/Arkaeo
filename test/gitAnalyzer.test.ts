import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedSymbol } from '../src/models/symbol';

// ---------------------------------------------------------------------------
// Mock child_process before importing anything that uses it
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import { GitAnalyzer } from '../src/analysis/gitAnalyzer';

// Convenience: make execFile behave like promisify(execFile) by
// calling the callback with (null, { stdout, stderr: '' })
function mockGit(responses: Record<string, string>): void {
  const mock = vi.mocked(execFile) as ReturnType<typeof vi.fn>;
  // Sort keys longest-first so more specific patterns (e.g. 'shortlog') are
  // matched before shorter ones that are substrings of them (e.g. 'log').
  const sortedKeys = Object.keys(responses).sort((a, b) => b.length - a.length);
  mock.mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, callback: (err: unknown, result: { stdout: string; stderr: string }) => void) => {
      const joined = args.join(' ');
      const key = sortedKeys.find((k) => joined.includes(k));
      const stdout = key ? (responses[key] ?? '') : '';
      callback(null, { stdout, stderr: '' });
      return {} as ReturnType<typeof execFile>;
    },
  );
}

// ---------------------------------------------------------------------------
// Fixture data — realistic git log output (NUL-separated fields)
// ---------------------------------------------------------------------------

const SEP = '\x00';

// Five commits, newest first
const FIXTURE_LOG = [
  `abc1234${SEP}2024-03-15T10:00:00+05:30${SEP}Alice${SEP}alice@example.com${SEP}fix: handle null input`,
  `def5678${SEP}2024-02-20T09:00:00+05:30${SEP}Bob${SEP}bob@example.com${SEP}refactor: extract helper`,
  `ghi9012${SEP}2024-01-10T08:00:00+05:30${SEP}Alice${SEP}alice@example.com${SEP}feat: add validation`,
  `jkl3456${SEP}2023-12-05T11:00:00+05:30${SEP}Charlie${SEP}charlie@example.com${SEP}chore: cleanup`,
  `mno7890${SEP}2023-11-01T07:00:00+05:30${SEP}Alice${SEP}alice@example.com${SEP}feat: initial implementation`,
].join('\n');

const FIXTURE_SHORTLOG = [
  '      3\tAlice <alice@example.com>',
  '      1\tBob <bob@example.com>',
  '      1\tCharlie <charlie@example.com>',
].join('\n');

const symbol: DetectedSymbol = {
  name: 'processPayment',
  kind: 'function',
  location: {
    filePath: '/repo/src/payments/processor.ts',
    relativePath: 'src/payments/processor.ts',
    startLine: 42,
    endLine: 60,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnalyzer(): GitAnalyzer {
  return new GitAnalyzer('/repo');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when not in a git repo', () => {
    it('returns empty GitHistory', async () => {
      mockGit({
        'rev-parse --is-inside-work-tree': '',
      });
      // Make isGitRepo throw so it returns false
      const mock = vi.mocked(execFile) as ReturnType<typeof vi.fn>;
      mock.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown) => void) => {
          cb(new Error('not a git repo'));
          return {} as ReturnType<typeof execFile>;
        },
      );

      const result = await makeAnalyzer().analyze(symbol);
      expect(result.commitCount).toBe(0);
      expect(result.recentCommits).toHaveLength(0);
      expect(result.firstIntroduced).toBeUndefined();
      expect(result.lastModified).toBeUndefined();
    });
  });

  describe('parseLog — realistic output', () => {
    beforeEach(() => {
      mockGit({
        'rev-parse --is-inside-work-tree': 'true',
        'rev-parse --show-toplevel': '/repo',
        'log': FIXTURE_LOG,
        'shortlog': FIXTURE_SHORTLOG,
      });
    });

    it('sets commitCount to the number of parsed commits', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      expect(result.commitCount).toBe(5);
    });

    it('sets lastModified to the most recent commit (first in log)', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      expect(result.lastModified).toBeDefined();
      expect(result.lastModified!.hash).toBe('abc1234');
      expect(result.lastModified!.author).toBe('Alice');
    });

    it('sets firstIntroduced to the oldest commit (last in log)', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      expect(result.firstIntroduced).toBeDefined();
      expect(result.firstIntroduced!.hash).toBe('mno7890');
      expect(result.firstIntroduced!.author).toBe('Alice');
    });

    it('caps recentCommits at MAX_RECENT_COMMITS (5)', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      expect(result.recentCommits.length).toBeLessThanOrEqual(5);
    });

    it('recentCommits entries have all required fields', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      for (const c of result.recentCommits) {
        expect(c.hash).toBeTruthy();
        expect(c.date).toBeTruthy();
        expect(c.author).toBeTruthy();
        expect(c.message).toBeTruthy();
      }
    });

    it('identifies the primary author correctly', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      expect(result.primaryAuthor).toBeDefined();
      expect(result.primaryAuthor!.name).toBe('Alice');
      expect(result.primaryAuthor!.email).toBe('alice@example.com');
    });

    it('computes primaryAuthor percentage as fraction of total', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      // Alice has 3 out of 5 commits = 0.6
      expect(result.primaryAuthor!.percentage).toBeCloseTo(0.6, 1);
    });

    it('recentCommits contains correct commit messages', async () => {
      const result = await makeAnalyzer().analyze(symbol);
      const messages = result.recentCommits.map((c) => c.message);
      expect(messages).toContain('fix: handle null input');
      expect(messages).toContain('refactor: extract helper');
    });
  });

  describe('empty log output', () => {
    it('returns empty GitHistory when log produces no output', async () => {
      const mock = vi.mocked(execFile) as ReturnType<typeof vi.fn>;
      let call = 0;
      mock.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, result: { stdout: string }) => void) => {
          call++;
          if (call <= 2) {
            // isGitRepo + getGitRoot succeed
            cb(null, { stdout: call === 1 ? 'true' : '/repo' });
          } else {
            // log returns empty
            cb(null, { stdout: '' });
          }
          return {} as ReturnType<typeof execFile>;
        },
      );

      const result = await makeAnalyzer().analyze(symbol);
      expect(result.commitCount).toBe(0);
      expect(result.recentCommits).toHaveLength(0);
    });
  });

  describe('log lines without separator are ignored', () => {
    it('skips diff hunk lines from git log -L output', async () => {
      // git log -L emits diff hunks between format lines — they must be filtered
      const mixedOutput = [
        `abc1234${SEP}2024-03-15T10:00:00+05:30${SEP}Alice${SEP}alice@example.com${SEP}fix: handle null`,
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -42,10 +42,10 @@',
        '-  const x = 1;',
        '+  const x = 2;',
        `def5678${SEP}2024-01-01T00:00:00+05:30${SEP}Bob${SEP}bob@example.com${SEP}feat: initial`,
      ].join('\n');

      mockGit({
        'rev-parse --is-inside-work-tree': 'true',
        'rev-parse --show-toplevel': '/repo',
        'log': mixedOutput,
        'shortlog': '      1\tAlice <alice@example.com>\n      1\tBob <bob@example.com>',
      });

      const result = await makeAnalyzer().analyze(symbol);
      expect(result.commitCount).toBe(2);
      expect(result.recentCommits[0]!.hash).toBe('abc1234');
      expect(result.recentCommits[1]!.hash).toBe('def5678');
    });
  });
});
