import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/ui/template';
import type { SymbolAnalysis } from '../src/models/analysis';

function makeAnalysis(overrides: Partial<SymbolAnalysis> = {}): SymbolAnalysis {
  return {
    symbol: {
      name: 'processPayment',
      kind: 'function',
      location: {
        filePath: '/repo/src/payments/processor.ts',
        relativePath: 'src/payments/processor.ts',
        startLine: 42,
        endLine: 60,
      },
      signature: '(amount: number): Promise<void>',
    },
    static: {
      imports: ['fs', 'path', './utils'],
      exports: ['processPayment'],
    },
    dependencies: {
      dependsOn: [{ name: 'readFileSync', filePath: 'fs', kind: 'import' }],
      usedBy: [
        { name: 'processPayment', filePath: '/repo/src/api/routes.ts', kind: 'reference' },
      ],
    },
    git: {
      commitCount: 12,
      recentCommits: [
        { hash: 'abc1234', date: '2024-01-10T10:00:00Z', message: 'fix payment edge case', author: 'Alice' },
      ],
      firstIntroduced: { hash: 'def5678', date: '2023-06-01T09:00:00Z', author: 'Bob' },
      lastModified: { hash: 'abc1234', date: '2024-01-10T10:00:00Z', author: 'Alice' },
      primaryAuthor: { name: 'Alice', email: 'alice@example.com', percentage: 0.75 },
    },
    risk: { level: 'medium', score: 42, reasons: ['Referenced in 1 file', 'Modified 12 times'] },
    analyzedAt: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('renderTemplate', () => {
  it('includes the symbol name in the output', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', false);
    expect(html).toContain('processPayment');
  });

  it('includes all required section headings', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', false);
    expect(html).toContain('Symbol');
    expect(html).toContain('Architecture');
    expect(html).toContain('Depends On');
    expect(html).toContain('Used By');
    expect(html).toContain('Git History');
    expect(html).toContain('Risk');
  });

  it('renders the correct risk badge class for medium level', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', false);
    expect(html).toContain('risk-medium');
  });

  it('renders risk-low badge for low risk', () => {
    const analysis = makeAnalysis({ risk: { level: 'low', score: 5, reasons: [] } });
    const html = renderTemplate(analysis, 'style.css', 'testnonce', false);
    expect(html).toContain('risk-low');
  });

  it('renders risk-high badge for high risk', () => {
    const analysis = makeAnalysis({ risk: { level: 'high', score: 80, reasons: ['Too many refs'] } });
    const html = renderTemplate(analysis, 'style.css', 'testnonce', false);
    expect(html).toContain('risk-high');
  });

  it('includes the nonce in the CSP header and script tag', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'uniquenonce123', false);
    expect(html).toContain("nonce-uniquenonce123");
    expect(html).toContain('nonce="uniquenonce123"');
  });

  it('does not include AI section when hasApiKey is false', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', false);
    expect(html).not.toContain('Explain with AI');
  });

  it('includes AI button when hasApiKey is true', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', true);
    expect(html).toContain('Explain with AI');
    expect(html).toContain('id="ai-btn"');
  });

  it('shows overflow notice when usedBy has 50 or more entries', () => {
    const usedBy = Array.from({ length: 50 }, (_, i) => ({
      name: 'processPayment',
      filePath: `/repo/src/file${i}.ts`,
      kind: 'reference' as const,
    }));
    const html = renderTemplate(makeAnalysis({ dependencies: { dependsOn: [], usedBy } }), 'style.css', 'testnonce', false);
    expect(html).toContain('Showing first 50 references');
  });

  it('shows empty state when usedBy is empty', () => {
    const html = renderTemplate(
      makeAnalysis({ dependencies: { dependsOn: [], usedBy: [] } }),
      'style.css',
      'testnonce',
      false,
    );
    expect(html).toContain('No references found in the workspace');
  });

  it('shows commit messages and author in git section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', false);
    expect(html).toContain('fix payment edge case');
    expect(html).toContain('Alice');
  });

  it('shows "No Git history" when commitCount is 0', () => {
    const analysis = makeAnalysis({ git: { commitCount: 0, recentCommits: [] } });
    const html = renderTemplate(analysis, 'style.css', 'testnonce', false);
    expect(html).toContain('No Git history');
  });

  it('escapes HTML special characters to prevent XSS', () => {
    const analysis = makeAnalysis();
    analysis.symbol.name = '<script>alert(1)</script>';
    const html = renderTemplate(analysis, 'style.css', 'testnonce', false);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes the signature when present', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'testnonce', false);
    expect(html).toContain('amount: number');
  });
});
