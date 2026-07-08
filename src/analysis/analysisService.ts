import type { SymbolAnalysis, DependencyAnalysis, RiskAssessment } from '../models/analysis';
import type { GitHistory } from '../models/git';
import { AstAnalyzer } from './astAnalyzer';

/**
 * Orchestrates all analyzers and merges results into a single SymbolAnalysis.
 *
 * Phase 1: only AST analysis is real. Dependency, Git, and Risk are stubs
 * that will be replaced in subsequent phases.
 */
export class AnalysisService {
  constructor(private readonly ast: AstAnalyzer) {}

  async analyzeSymbol(
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolAnalysis | null> {
    const symbol = this.ast.detectSymbolAtPosition(filePath, line, character);
    if (!symbol) return null;

    const staticAnalysis = this.ast.analyzeStatic(symbol);

    // Stubs — replaced in Phase 2, 3, and 4 respectively.
    const dependencies: DependencyAnalysis = { dependsOn: [], usedBy: [] };
    const git: GitHistory = { commitCount: 0, recentCommits: [] };
    const risk: RiskAssessment = { level: 'low', score: 0, reasons: [] };

    return {
      symbol,
      static: staticAnalysis,
      dependencies,
      git,
      risk,
      analyzedAt: new Date().toISOString(),
    };
  }
}
