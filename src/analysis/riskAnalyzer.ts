import type { RiskAssessment, RiskLevel } from '../models/analysis';

// ---------------------------------------------------------------------------
// Scoring weights — all values are additive points toward a 0–100 score.
// Thresholds: Low < 30, Medium 30–59, High 60+
// ---------------------------------------------------------------------------

const W = {
  // Each reference to this symbol adds 2 pts, capped at 30
  refCountPerRef: 2,
  refCountCap: 30,

  // Each commit adds 1 pt, capped at 20 (churn indicator)
  commitCountPerCommit: 1,
  commitCountCap: 20,

  // Each TODO/FIXME/HACK/XXX marker adds 5 pts (uncapped — explicit debt)
  todoPerMarker: 5,

  // Symbol modified in the last 7 days — actively in flux
  recentlyModifiedBonus: 15,

  // Single author owns < 50 % of commits — bus factor risk
  lowAuthorConcentrationBonus: 10,
} as const;

export interface RiskInput {
  /** Number of files/symbols that reference this symbol */
  referenceCount: number;
  /** Total number of commits touching this symbol's line range */
  commitCount: number;
  /** Number of days since the last modification (0 = today) */
  daysSinceLastModify: number;
  /** Number of TODO/FIXME/HACK/XXX markers near the symbol */
  todoCount: number;
  /**
   * Fraction of commits by the top author (0–1).
   * 1.0 = single author wrote everything (concentrated).
   * 0.0 = evenly distributed across many authors (bus factor risk).
   * undefined = not enough data to compute.
   */
  authorConcentration?: number;
}

/**
 * Computes a deterministic risk assessment from pre-collected analysis data.
 * No network calls, no AI, no randomness.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  // ── References ────────────────────────────────────────────────────────────
  const refPoints = Math.min(input.referenceCount * W.refCountPerRef, W.refCountCap);
  score += refPoints;
  if (input.referenceCount >= 10) {
    reasons.push(`Referenced in ${input.referenceCount} location${input.referenceCount === 1 ? '' : 's'}`);
  }

  // ── Commit churn ──────────────────────────────────────────────────────────
  const commitPoints = Math.min(input.commitCount * W.commitCountPerCommit, W.commitCountCap);
  score += commitPoints;
  if (input.commitCount >= 10) {
    reasons.push(`Modified ${input.commitCount} times — high churn`);
  }

  // ── TODO/FIXME markers ────────────────────────────────────────────────────
  if (input.todoCount > 0) {
    score += input.todoCount * W.todoPerMarker;
    reasons.push(
      `Contains ${input.todoCount} TODO/FIXME marker${input.todoCount === 1 ? '' : 's'}`,
    );
  }

  // ── Recent modification ───────────────────────────────────────────────────
  if (input.daysSinceLastModify >= 0 && input.daysSinceLastModify < 7) {
    score += W.recentlyModifiedBonus;
    reasons.push('Modified in the last 7 days — actively changing');
  }

  // ── Author concentration / bus factor ─────────────────────────────────────
  if (input.authorConcentration !== undefined && input.authorConcentration < 0.5) {
    score += W.lowAuthorConcentrationBonus;
    reasons.push('Spread across many authors — potential bus factor');
  }

  const level = scoreToLevel(score);

  return { level, score, reasons };
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// TODO/FIXME scanner — operates on raw source text, no AST required
// ---------------------------------------------------------------------------

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/gi;

/**
 * Counts TODO/FIXME/HACK/XXX occurrences within the symbol's line range
 * plus a ±10 line buffer for context.
 */
export function countTodoMarkers(sourceLines: string[], startLine: number, endLine: number): number {
  // Lines are 1-based in DetectedSymbol; convert to 0-based array indices
  const from = Math.max(0, startLine - 1 - 10);
  const to = Math.min(sourceLines.length - 1, endLine - 1 + 10);

  let count = 0;
  for (let i = from; i <= to; i++) {
    const line = sourceLines[i];
    if (!line) continue;
    const matches = line.match(TODO_PATTERN);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Computes how many whole days have elapsed since an ISO date string.
 * Returns -1 if the date is unparseable.
 */
export function daysSince(isoDate: string): number {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return -1;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.now() - d.getTime()) / msPerDay);
}
