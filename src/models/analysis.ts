import type { DetectedSymbol } from './symbol';
import type { GitHistory } from './git';

export interface StaticAnalysis {
  imports: string[];
  exports: string[];
  /** Method names — only populated when symbol kind is 'class' */
  methods?: string[];
}

export type DependencyKind = 'import' | 'reference' | 'call';

export interface DependencyRef {
  name: string;
  filePath: string;
  kind: DependencyKind;
}

export interface DependencyAnalysis {
  dependsOn: DependencyRef[];
  usedBy: DependencyRef[];
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskAssessment {
  level: RiskLevel;
  /** Raw 0–100 score for debugging/sorting */
  score: number;
  reasons: string[];
}

export interface SymbolAnalysis {
  symbol: DetectedSymbol;
  static: StaticAnalysis;
  dependencies: DependencyAnalysis;
  git: GitHistory;
  risk: RiskAssessment;
  /** ISO 8601 timestamp */
  analyzedAt: string;
}
