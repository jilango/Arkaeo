import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { AstAnalyzer } from '../src/analysis/astAnalyzer';

const FIXTURE = path.resolve(__dirname, 'fixtures/sample.ts');

// Line numbers are 1-based in ts-morph getStartLineNumber().
// We use 0-based offsets when calling detectSymbolAtPosition (matching VS Code).
// ts-morph's getPositionOfLineAndCharacter is 0-based for both line and char.

let analyzer: AstAnalyzer;

beforeAll(() => {
  analyzer = new AstAnalyzer();
});

// ---------------------------------------------------------------------------
// Symbol detection
// ---------------------------------------------------------------------------

describe('detectSymbolAtPosition', () => {
  it('detects a plain exported function', () => {
    // Place cursor inside the body of getUserById (line 13 in sample.ts, 0-based = 12)
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 12, 10);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('getUserById');
    expect(symbol!.kind).toBe('function');
    expect(symbol!.containingClass).toBeUndefined();
  });

  it('detects an arrow function via variable declaration (cursor on body)', () => {
    // Line 17 body: `  return \`${user.name} (${user.id})\`;` (0-based = 17)
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 17, 4);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('formatUser');
    expect(symbol!.kind).toBe('function');
  });

  it('detects an arrow function via variable declaration (cursor on const keyword)', () => {
    // Line 16: `export const formatUser = ...` — cursor on variable name (0-based = 16, char 13)
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 16, 13);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('formatUser');
    expect(symbol!.kind).toBe('function');
  });

  it('detects a named function expression', () => {
    // Line 22 body: `  return JSON.parse(raw)...` (0-based = 22)
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 22, 4);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('parseConfig');
    expect(symbol!.kind).toBe('function');
  });

  it('detects a class', () => {
    // UserService class declaration on line 27 (0-based = 26)
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 26, 10);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('UserService');
    expect(symbol!.kind).toBe('class');
  });

  it('detects a method with containingClass set', () => {
    // addUser method on line 30 (0-based = 29)
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 29, 4);
    expect(symbol).not.toBeNull();
    expect(symbol!.name).toBe('addUser');
    expect(symbol!.kind).toBe('method');
    expect(symbol!.containingClass).toBe('UserService');
  });

  it('returns null when cursor is on a blank line or comment', () => {
    // Line 0 is a comment in sample.ts
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 0, 0);
    expect(symbol).toBeNull();
  });

  it('populates location with filePath and line numbers', () => {
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 12, 10);
    expect(symbol!.location.filePath).toBe(FIXTURE);
    expect(symbol!.location.startLine).toBeGreaterThan(0);
    expect(symbol!.location.endLine).toBeGreaterThanOrEqual(symbol!.location.startLine);
  });

  it('builds a signature string for a function', () => {
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 12, 10);
    expect(symbol!.signature).toBeDefined();
    expect(symbol!.signature).toContain('userId');
  });
});

// ---------------------------------------------------------------------------
// Static analysis
// ---------------------------------------------------------------------------

describe('analyzeStatic', () => {
  it('lists all imports', () => {
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 12, 10)!;
    const result = analyzer.analyzeStatic(symbol);
    expect(result.imports).toContain('fs');
    expect(result.imports).toContain('path');
  });

  it('lists exported identifiers', () => {
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 12, 10)!;
    const result = analyzer.analyzeStatic(symbol);
    expect(result.exports).toContain('getUserById');
    expect(result.exports).toContain('UserService');
  });

  it('lists class methods when symbol is a class', () => {
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 26, 10)!;
    expect(symbol.kind).toBe('class');
    const result = analyzer.analyzeStatic(symbol);
    expect(result.methods).toBeDefined();
    expect(result.methods).toContain('addUser');
    expect(result.methods).toContain('getUser');
    expect(result.methods).toContain('listUsers');
  });

  it('does not include methods for non-class symbols', () => {
    const symbol = analyzer.detectSymbolAtPosition(FIXTURE, 12, 10)!;
    expect(symbol.kind).toBe('function');
    const result = analyzer.analyzeStatic(symbol);
    expect(result.methods).toBeUndefined();
  });
});
