import * as fs from 'fs';
import { AstAnalyzer } from './astAnalyzer';
import { DependencyAnalyzer } from './dependencyAnalyzer';
import { GitAnalyzer } from './gitAnalyzer';
import { assessRisk, countTodoMarkers, daysSince } from './riskAnalyzer';
import type { SymbolAnalysis } from '../models/analysis';

/**
 * Orchestrates all analyzers and merges results into a single SymbolAnalysis.
 * All phases complete as of Phase 4.
 */
export class AnalysisService {
  private readonly deps: DependencyAnalyzer;
  private readonly git: GitAnalyzer;

  constructor(
    private readonly ast: AstAnalyzer,
    workspaceRoot: string,
  ) {
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

    // All three primary analyzers run in parallel — none depends on the others.
    const [staticAnalysis, dependencies, git] = await Promise.all([
      Promise.resolve(this.ast.analyzeStatic(symbol)),
      this.deps.analyze(symbol),
      this.git.analyze(symbol),
    ]);

    // TODO/FIXME scan — read source file synchronously (already on disk, fast).
    let todoCount = 0;
    try {
      const src = fs.readFileSync(filePath, 'utf8');
      const lines = src.split('\n');
      todoCount = countTodoMarkers(lines, symbol.location.startLine, symbol.location.endLine);
    } catch {
      // Unreadable file — skip TODO scan
    }

    const risk = assessRisk({
      referenceCount: dependencies.usedBy.length,
      commitCount: git.commitCount,
      daysSinceLastModify: git.lastModified ? daysSince(git.lastModified.date) : -1,
      todoCount,
      authorConcentration: git.primaryAuthor?.percentage,
    });

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
