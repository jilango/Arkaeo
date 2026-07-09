import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { Project } from 'ts-morph';
import { AstAnalyzer } from '../src/analysis/astAnalyzer';
import { DependencyAnalyzer } from '../src/analysis/dependencyAnalyzer';

const SAMPLE = path.resolve(__dirname, 'fixtures/sample.ts');
const CONSUMER = path.resolve(__dirname, 'fixtures/consumer.ts');
const CLASS_SERVICE = path.resolve(__dirname, 'fixtures/classService.ts');
const HELPER_A = path.resolve(__dirname, 'fixtures/helperA.ts');
const HELPER_B = path.resolve(__dirname, 'fixtures/helperB.ts');
const ANALYSIS_SERVICE = path.resolve(__dirname, '../src/analysis/analysisService.ts');
const TSCONFIG = path.resolve(__dirname, '../tsconfig.json');

let astAnalyzer: AstAnalyzer;
let depAnalyzer: DependencyAnalyzer;

beforeAll(() => {
  astAnalyzer = new AstAnalyzer();
  astAnalyzer.project.addSourceFileAtPath(SAMPLE);
  astAnalyzer.project.addSourceFileAtPath(CONSUMER);
  astAnalyzer.project.addSourceFileAtPath(CLASS_SERVICE);
  astAnalyzer.project.addSourceFileAtPath(HELPER_A);
  astAnalyzer.project.addSourceFileAtPath(HELPER_B);
  depAnalyzer = new DependencyAnalyzer(astAnalyzer.project);
});

// ---------------------------------------------------------------------------
// Depends On
// ---------------------------------------------------------------------------

describe('DependencyAnalyzer.dependsOn', () => {
  it('detects imported identifiers used within a function body', async () => {
    // displayUser in consumer.ts imports and calls getUserById from sample.ts
    const symbol = astAnalyzer.detectSymbolAtPosition(CONSUMER, 5, 10);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('displayUser');

    const result = await depAnalyzer.analyze(symbol!);
    const names = result.dependsOn.map((d) => d.name);
    expect(names).toContain('getUserById');
  });

  it('returns empty dependsOn for a symbol with no imports used in body', async () => {
    // getUserById in sample.ts does not use any imported identifiers in its body
    const symbol = astAnalyzer.detectSymbolAtPosition(SAMPLE, 12, 10);
    expect(symbol!.name).toBe('getUserById');

    const result = await depAnalyzer.analyze(symbol!);
    expect(result.dependsOn).toHaveLength(0);
  });

  it('all dependsOn entries are import or call dependencies', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(CONSUMER, 5, 10)!;
    const result = await depAnalyzer.analyze(symbol);
    for (const dep of result.dependsOn) {
      expect(['import', 'call']).toContain(dep.kind);
    }
  });

  it('detects this.property dependencies via class member types', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(CLASS_SERVICE, 11, 6);
    expect(symbol?.name).toBe('run');

    const result = await depAnalyzer.analyze(symbol!);
    const paths = result.dependsOn.map((d) => d.filePath);
    expect(paths.some((p) => p.endsWith('helperA.ts'))).toBe(true);
    expect(result.dependsOn.some((d) => d.kind === 'call' && d.name === 'a')).toBe(true);
    expect(result.dependsOn.some((d) => d.kind === 'call' && d.name === 'store')).toBe(true);
    expect(result.dependsOn.some((d) => d.kind === 'import' && d.name === 'helperFn')).toBe(true);
  });

  it('does not treat type-only imports or return types as runtime dependencies', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(CLASS_SERVICE, 11, 6)!;
    const result = await depAnalyzer.analyze(symbol);
    expect(result.dependsOn.some((d) => d.name === 'HelperLabel')).toBe(false);
  });
});

describe('DependencyAnalyzer.analyzeSymbol integration', () => {
  let projectAnalyzer: DependencyAnalyzer;
  let projectAst: AstAnalyzer;

  beforeAll(() => {
    projectAst = new AstAnalyzer(TSCONFIG);
    projectAnalyzer = new DependencyAnalyzer(projectAst.project);
  });

  it('resolves analyzeSymbol runtime deps including this.* analyzers', async () => {
    const symbol = projectAst.detectSymbolAtPosition(ANALYSIS_SERVICE, 23, 10);
    expect(symbol?.name).toBe('analyzeSymbol');

    const result = await projectAnalyzer.analyze(symbol!);
    const paths = result.dependsOn.map((d) => d.filePath);

    expect(paths.some((p) => p.includes('astAnalyzer'))).toBe(true);
    expect(paths.some((p) => p.includes('dependencyAnalyzer'))).toBe(true);
    expect(paths.some((p) => p.includes('gitAnalyzer'))).toBe(true);
    expect(paths.some((p) => p.includes('riskAnalyzer'))).toBe(true);
    expect(paths.some((p) => p === 'fs' || p.endsWith('/fs'))).toBe(true);
    expect(paths.some((p) => p.includes('models/analysis'))).toBe(false);
    expect(result.dependsOn.some((d) => d.kind === 'call' && d.name === 'ast')).toBe(true);
    expect(result.dependsOn.some((d) => d.kind === 'call' && d.name === 'deps')).toBe(true);
    expect(result.dependsOn.some((d) => d.kind === 'call' && d.name === 'git')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Used By (ts-morph fallback — VSCode API unavailable in tests)
// ---------------------------------------------------------------------------

describe('DependencyAnalyzer.usedBy (ts-morph fallback)', () => {
  it('finds consumer.ts as a reference to getUserById in sample.ts', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(SAMPLE, 12, 10);
    expect(symbol!.name).toBe('getUserById');

    const result = await depAnalyzer.analyze(symbol!);
    const paths = result.usedBy.map((r) => r.filePath);
    expect(paths.some((p) => p.includes('consumer'))).toBe(true);
  });

  it('does not include the symbol\'s own file in usedBy', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(SAMPLE, 12, 10)!;
    const result = await depAnalyzer.analyze(symbol!);
    expect(result.usedBy.every((r) => r.filePath !== SAMPLE)).toBe(true);
  });

  it('caps results at 50', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(SAMPLE, 12, 10)!;
    const result = await depAnalyzer.analyze(symbol!);
    expect(result.usedBy.length).toBeLessThanOrEqual(50);
  });
});
