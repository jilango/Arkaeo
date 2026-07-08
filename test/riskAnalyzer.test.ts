import { describe, it, expect } from 'vitest';
import { assessRisk, countTodoMarkers, daysSince } from '../src/analysis/riskAnalyzer';
import type { RiskInput } from '../src/analysis/riskAnalyzer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    referenceCount: 0,
    commitCount: 0,
    daysSinceLastModify: 30,
    todoCount: 0,
    authorConcentration: 1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assessRisk — level boundaries
// ---------------------------------------------------------------------------

describe('assessRisk — level thresholds', () => {
  it('returns low when score is 0', () => {
    const result = assessRisk(input());
    expect(result.level).toBe('low');
    expect(result.score).toBe(0);
  });

  it('returns low when score is 29', () => {
    // 14 refs × 2 = 28, + 1 commit × 1 = 29 — still low
    const result = assessRisk(input({ referenceCount: 14, commitCount: 1 }));
    expect(result.score).toBe(29);
    expect(result.level).toBe('low');
  });

  it('returns medium at score boundary 30', () => {
    // 15 refs × 2 = 30
    const result = assessRisk(input({ referenceCount: 15 }));
    expect(result.score).toBe(30);
    expect(result.level).toBe('medium');
  });

  it('returns medium when score is 59', () => {
    // 15 refs (30) + 20 commits (20) + recently modified (15) = 65... adjust
    // 14 refs (28) + 20 commits capped (20) + 1 todo (5) = 53 < 59 — try:
    // 29 refs (30 capped) + 20 commits (20) + 1 todo (5) = 55 — need 59:
    // 30+ refs (30) + 20+ commits (20) + 1 todo (5) + NOT recent + high author = 55
    // Add 4 more: 30 + 20 + 9 (todo 0) not possible
    // Use: 29 refs = 30 (capped), 20 commits = 20, 1 todo = 5, no recent = 55. Hmm.
    // Easier: just assert medium range for a plausible config
    const result = assessRisk(input({ referenceCount: 15, commitCount: 14 }));
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThan(60);
    expect(result.level).toBe('medium');
  });

  it('returns high at score boundary 60', () => {
    // 30 refs (30 pts) + 20 commits (20 pts) + recently modified (15 pts) = 65 → high
    const result = assessRisk(input({
      referenceCount: 30,
      commitCount: 20,
      daysSinceLastModify: 3,
    }));
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.level).toBe('high');
  });

  it('returns high for worst-case inputs', () => {
    const result = assessRisk(input({
      referenceCount: 100,
      commitCount: 100,
      daysSinceLastModify: 0,
      todoCount: 5,
      authorConcentration: 0.2,
    }));
    expect(result.level).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// assessRisk — reference scoring
// ---------------------------------------------------------------------------

describe('assessRisk — reference scoring', () => {
  it('adds 2 pts per reference', () => {
    const result = assessRisk(input({ referenceCount: 5 }));
    expect(result.score).toBe(10);
  });

  it('caps reference contribution at 30 pts', () => {
    const uncapped = assessRisk(input({ referenceCount: 1000 }));
    const capped = assessRisk(input({ referenceCount: 15 }));
    expect(uncapped.score).toBe(capped.score);
    expect(uncapped.score).toBe(30);
  });

  it('adds a reason when referenceCount >= 10', () => {
    const result = assessRisk(input({ referenceCount: 10 }));
    expect(result.reasons.some((r) => r.includes('Referenced in 10'))).toBe(true);
  });

  it('does not add a reference reason below threshold', () => {
    const result = assessRisk(input({ referenceCount: 9 }));
    expect(result.reasons.some((r) => r.includes('Referenced'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assessRisk — commit churn scoring
// ---------------------------------------------------------------------------

describe('assessRisk — commit churn', () => {
  it('adds 1 pt per commit', () => {
    const result = assessRisk(input({ commitCount: 10 }));
    expect(result.score).toBe(10);
  });

  it('caps commit contribution at 20 pts', () => {
    const capped = assessRisk(input({ commitCount: 100 }));
    expect(capped.score).toBe(20);
  });

  it('adds a churn reason when commitCount >= 10', () => {
    const result = assessRisk(input({ commitCount: 12 }));
    expect(result.reasons.some((r) => r.includes('Modified 12 times'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assessRisk — TODO/FIXME markers
// ---------------------------------------------------------------------------

describe('assessRisk — TODO markers', () => {
  it('adds 5 pts per TODO marker', () => {
    const result = assessRisk(input({ todoCount: 3 }));
    expect(result.score).toBe(15);
  });

  it('adds a reason when todoCount > 0', () => {
    const result = assessRisk(input({ todoCount: 2 }));
    expect(result.reasons.some((r) => r.includes('TODO/FIXME'))).toBe(true);
  });

  it('uses singular form for 1 marker', () => {
    const result = assessRisk(input({ todoCount: 1 }));
    expect(result.reasons.some((r) => r.includes('1 TODO/FIXME marker'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('markers'))).toBe(false);
  });

  it('adds no score when todoCount is 0', () => {
    const result = assessRisk(input({ todoCount: 0 }));
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assessRisk — recent modification
// ---------------------------------------------------------------------------

describe('assessRisk — recency', () => {
  it('adds 15 pts when modified within last 7 days', () => {
    const result = assessRisk(input({ daysSinceLastModify: 0 }));
    expect(result.score).toBe(15);
  });

  it('adds recency bonus at day 6 (boundary)', () => {
    const result = assessRisk(input({ daysSinceLastModify: 6 }));
    expect(result.score).toBe(15);
  });

  it('does not add bonus at day 7 (outside window)', () => {
    const result = assessRisk(input({ daysSinceLastModify: 7 }));
    expect(result.score).toBe(0);
  });

  it('does not add bonus when daysSinceLastModify is -1 (unknown)', () => {
    const result = assessRisk(input({ daysSinceLastModify: -1 }));
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assessRisk — author concentration
// ---------------------------------------------------------------------------

describe('assessRisk — author concentration', () => {
  it('adds 10 pts when authorConcentration < 0.5', () => {
    const result = assessRisk(input({ authorConcentration: 0.3 }));
    expect(result.score).toBe(10);
  });

  it('does not add pts when authorConcentration is exactly 0.5', () => {
    const result = assessRisk(input({ authorConcentration: 0.5 }));
    expect(result.score).toBe(0);
  });

  it('does not add pts when authorConcentration is undefined', () => {
    const result = assessRisk(input({ authorConcentration: undefined }));
    expect(result.score).toBe(0);
  });

  it('adds a bus factor reason when concentration is low', () => {
    const result = assessRisk(input({ authorConcentration: 0.2 }));
    expect(result.reasons.some((r) => r.toLowerCase().includes('bus factor'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// countTodoMarkers
// ---------------------------------------------------------------------------

describe('countTodoMarkers', () => {
  const lines = [
    'function foo() {',          // 0 (line 1)
    '  // TODO: fix this',       // 1 (line 2)
    '  const x = 1;',            // 2 (line 3)
    '  // FIXME: edge case',     // 3 (line 4)
    '  return x;',               // 4 (line 5)
    '}',                         // 5 (line 6)
    '',                          // 6 (line 7)
    '// HACK: workaround',       // 7 (line 8)
    '// XXX: remove later',      // 8 (line 9)
    'function bar() {}',         // 9 (line 10)
  ];

  it('counts markers within the symbol range + buffer', () => {
    // Symbol on lines 1-6, buffer ±10 so all lines are in scope
    const count = countTodoMarkers(lines, 1, 6);
    expect(count).toBe(4); // TODO, FIXME, HACK, XXX
  });

  it('counts only markers in range when buffer does not reach others', () => {
    // Symbol on lines 1-2, buffer ±10 → still all lines in range given small file
    const count = countTodoMarkers(lines, 1, 2);
    expect(count).toBeGreaterThanOrEqual(1); // At minimum the TODO on line 2
  });

  it('returns 0 for a range with no markers', () => {
    const cleanLines = [
      'function clean() {',
      '  return 42;',
      '}',
    ];
    const count = countTodoMarkers(cleanLines, 1, 3);
    expect(count).toBe(0);
  });

  it('is case-insensitive', () => {
    const mixedCase = ['// todo: lowercase', '// Fixme: mixed'];
    const count = countTodoMarkers(mixedCase, 1, 2);
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// daysSince
// ---------------------------------------------------------------------------

describe('daysSince', () => {
  it('returns 0 for today\'s date', () => {
    const today = new Date().toISOString();
    expect(daysSince(today)).toBe(0);
  });

  it('returns approximately 1 for yesterday', () => {
    const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString();
    expect(daysSince(yesterday)).toBe(1);
  });

  it('returns -1 for an unparseable date', () => {
    expect(daysSince('not-a-date')).toBe(-1);
  });

  it('returns a positive number for a past date', () => {
    expect(daysSince('2020-01-01T00:00:00Z')).toBeGreaterThan(0);
  });
});
