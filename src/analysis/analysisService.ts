import type { SymbolAnalysis, RiskAssessment } from '../models/analysis';
import { AstAnalyzer } from './astAnalyzer';
import { DependencyAnalyzer } from './dependencyAnalyzer';
import { GitAnalyzer } from './gitAnalyzer';

/**
 * Orchestrates all analyzers and merges results into a single SymbolAnalysis.
 *
 * Phase 3: real AST + dependency + git analysis. Risk is still a stub.
 */
export class AnalysisService {
  private readonly deps: DependencyAnalyzer;
  private readonly git: GitAnalyzer;

  constructor(
    private readonly ast: AstAnalyzer,
    workspaceRoot: string,
  ) {
    // Share the same ts-morph Project so source files are parsed only once.
    this.deps = new DependencyAnalyzer(ast.project);
    this.git = new GitAnalyzer(workspaceRoot);
  }

  async analyzeSymbol(
    filePath: string,
    line: number,
    character: number,
  ): Promise<SymbolAnalysis | null> {
    const symbol = this.ast.detectSymbolAtPosition(filePath, line, character);
    if (!symbol) return null;

    // All three analyzers run in parallel — none depends on the others' output.
    const [staticAnalysis, dependencies, git] = await Promise.all([
      Promise.resolve(this.ast.analyzeStatic(symbol)),
      this.deps.analyze(symbol),
      this.git.analyze(symbol),
    ]);

    // Risk stub — replaced in Phase 4.
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
