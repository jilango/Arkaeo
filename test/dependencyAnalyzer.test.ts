import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { Project } from 'ts-morph';
import { AstAnalyzer } from '../src/analysis/astAnalyzer';
import { DependencyAnalyzer } from '../src/analysis/dependencyAnalyzer';

const SAMPLE = path.resolve(__dirname, 'fixtures/sample.ts');
const CONSUMER = path.resolve(__dirname, 'fixtures/consumer.ts');

let astAnalyzer: AstAnalyzer;
let depAnalyzer: DependencyAnalyzer;

beforeAll(() => {
  astAnalyzer = new AstAnalyzer();
  // Pre-load both fixtures into the shared project
  astAnalyzer.project.addSourceFileAtPath(SAMPLE);
  astAnalyzer.project.addSourceFileAtPath(CONSUMER);
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

  it('all dependsOn entries have a kind of import', async () => {
    const symbol = astAnalyzer.detectSymbolAtPosition(CONSUMER, 5, 10)!;
    const result = await depAnalyzer.analyze(symbol);
    for (const dep of result.dependsOn) {
      expect(dep.kind).toBe('import');
    }
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
