import type { SymbolAnalysis, RiskAssessment } from '../models/analysis';
import type { GitHistory } from '../models/git';
import { AstAnalyzer } from './astAnalyzer';
import { DependencyAnalyzer } from './dependencyAnalyzer';

/**
 * Orchestrates all analyzers and merges results into a single SymbolAnalysis.
 *
 * Phase 2: real AST + dependency analysis. Git and Risk are stubs.
 */
export class AnalysisService {
  private readonly deps: DependencyAnalyzer;

  constructor(private readonly ast: AstAnalyzer) {
    // Share the same ts-morph Project so source files are parsed only once.
    this.deps = new DependencyAnalyzer(ast.project);
  }

  async analyzeSymbol(
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolAnalysis | null> {
    const symbol = this.ast.detectSymbolAtPosition(filePath, line, character);
    if (!symbol) return null;

    // Run static and dependency analysis in parallel.
    const [staticAnalysis, dependencies] = await Promise.all([
      Promise.resolve(this.ast.analyzeStatic(symbol)),
      this.deps.analyze(symbol),
    ]);

    // Stubs — replaced in Phase 3 (git) and Phase 4 (risk).
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
