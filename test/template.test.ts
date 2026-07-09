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
        nameColumn: 4,
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
      coChangedWith: [
        { filePath: '/repo/src/api/routes.ts', relativePath: 'src/api/routes.ts', count: 8 },
        { filePath: '/repo/src/server.ts', relativePath: 'src/server.ts', count: 4 },
      ],
    },
    risk: { level: 'medium', score: 42, reasons: ['Referenced in 1 file', 'Modified 12 times'] },
    analyzedAt: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('renderTemplate', () => {

  // ── Basics ────────────────────────────────────────────────────────────────

  it('includes the symbol name in the output', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('processPayment');
  });

  it('includes all required section headings', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('header-title');
    expect(html).toContain('Architecture');
    expect(html).toContain('Dependencies');
    expect(html).toContain('Depends On');
    expect(html).toContain('Used By');
    expect(html).toContain('Git History');
    expect(html).toContain('Risk');
    // AI is now a header button, not a section heading
    expect(html).toContain('id="ai-btn"');
  });

  // ── CSP / nonce ───────────────────────────────────────────────────────────

  it('includes the nonce in the CSP header and script tag', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'uniquenonce123', false);
    expect(html).toContain('nonce-uniquenonce123');
    expect(html).toContain('nonce="uniquenonce123"');
  });

  // ── XSS / safety ─────────────────────────────────────────────────────────

  it('escapes HTML special characters to prevent XSS', () => {
    const analysis = makeAnalysis();
    analysis.symbol.name = '<script>alert(1)</script>';
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ── Architecture — chip rows ──────────────────────────────────────────────

  it('renders import chips in Architecture section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('class="chip"');
    // All three imports appear as chips
    expect(html).toContain('>fs<');
    expect(html).toContain('>path<');
    expect(html).toContain('./utils');
  });

  it('renders export chips in Architecture section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('chip--export');
    expect(html).toContain('>processPayment<');
  });

  it('shows Imports and Exports row labels', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('Imports');
    expect(html).toContain('Exports');
  });

  // ── Depends On ────────────────────────────────────────────────────────────

  it('shows depends-on items with kind badge', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('dep-kind-badge');
    expect(html).toContain('readFileSync');
  });

  it('shows count badge in Dependencies header (sum of dependsOn + usedBy)', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    // 1 dependsOn + 1 usedBy = 2 total
    expect(html).toContain('count-badge');
    expect(html).toContain('>2<');
  });

  it('shows empty state when dependsOn is empty', () => {
    const analysis = makeAnalysis({ dependencies: { dependsOn: [], usedBy: [] } });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('No outgoing dependencies detected');
  });

  // ── Used By ───────────────────────────────────────────────────────────────

  it('shows used-by file paths as links', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('api/routes.ts');
  });

  it('shows overflow notice when usedBy has 50 or more entries', () => {
    const usedBy = Array.from({ length: 50 }, (_, i) => ({
      name: 'processPayment',
      filePath: `/repo/src/file${i}.ts`,
      kind: 'reference' as const,
    }));
    const html = renderTemplate(
      makeAnalysis({ dependencies: { dependsOn: [], usedBy } }),
      'style.css', 'vscode-webview-resource:', 'testnonce', false,
    );
    expect(html).toContain('Showing first 50 references');
  });

  it('shows empty state when usedBy is empty', () => {
    const html = renderTemplate(
      makeAnalysis({ dependencies: { dependsOn: [], usedBy: [] } }),
      'style.css', 'vscode-webview-resource:', 'testnonce', false,
    );
    expect(html).toContain('No references found in the workspace');
  });

  // ── Git History ───────────────────────────────────────────────────────────

  it('shows git meta card grid with four cards', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('git-meta-grid');
    expect(html).toContain('git-meta-card');
    expect(html).toContain('Created');
    expect(html).toContain('Last Modified');
    expect(html).toContain('Author');
    expect(html).toContain('Commits');
  });

  it('shows commit messages and author in git section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('fix payment edge case');
    expect(html).toContain('Alice');
  });

  it('shows abbreviated commit hash with color chip', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('abc1234');
    expect(html).toContain('hash-teal');
  });

  it('shows "No Git history" when commitCount is 0', () => {
    const analysis = makeAnalysis({ git: { commitCount: 0, recentCommits: [] } });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('No Git history');
  });

  it('does NOT render SVG gauge in risk section', () => {
    // gauge exists but git-meta-grid should be separate
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('git-meta-grid');
  });

  it('renders SVG circular gauge in risk section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('risk-gauge-svg');
    expect(html).toContain('stroke-dasharray');
    expect(html).toContain('>42<');
  });

  // ── Risk ──────────────────────────────────────────────────────────────────

  it('renders risk-badge--medium for medium risk', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('risk-badge--medium');
  });

  it('renders risk-badge--low for low risk', () => {
    const analysis = makeAnalysis({ risk: { level: 'low', score: 5, reasons: [] } });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('risk-badge--low');
  });

  it('renders risk-badge--high for high risk', () => {
    const analysis = makeAnalysis({ risk: { level: 'high', score: 80, reasons: ['Too many refs'] } });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('risk-badge--high');
  });

  it('renders risk reasons as a list', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('reason-list');
    expect(html).toContain('Referenced in 1 file');
    expect(html).toContain('Modified 12 times');
  });

  it('shows empty state for risk when no reasons', () => {
    const analysis = makeAnalysis({ risk: { level: 'low', score: 5, reasons: [] } });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('No specific risk factors identified');
  });

  // ── AI section ────────────────────────────────────────────────────────────

  it('shows greyed-out AI button in header with setup tip when hasApiKey is false', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('ai-button--header');
    expect(html).toContain('ai-button--locked');
    expect(html).toContain('disabled');
    expect(html).toContain('No API key set');
  });

  it('includes active AI button in header when hasApiKey is true', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', true);
    expect(html).toContain('ai-button--header');
    expect(html).toContain('id="ai-btn"');
    expect(html).not.toContain('ai-button--locked');
  });

  it('AI output panel exists and is hidden by default', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', true);
    expect(html).toContain('id="ai-result-panel"');
    expect(html).toContain('id="ai-output"');
    expect(html).toContain('Engineering Summary');
  });

  it('AI button appears before Risk section in header', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    const aiIdx = html.indexOf('ai-button--header');
    const riskIdx = html.indexOf('risk-badge');
    expect(aiIdx).toBeLessThan(riskIdx);
  });

  // ── Signature ─────────────────────────────────────────────────────────────

  it('includes the full signature in sig-panel', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('amount: number');
    expect(html).toContain('id="sig-panel"');
  });

  it('shows sig toggle button when signature is present', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('class="sig-toggle-btn"');
  });

  it('sig-panel exists and is hidden via CSS (no hidden attribute)', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('id="sig-panel"');
    // Visibility is controlled by CSS display:none on .sig-panel, not the HTML hidden attribute
    expect(html).not.toContain('<div class="sig-panel" id="sig-panel" hidden');
  });

  it('does not render sig-toggle-btn when symbol has no signature', () => {
    const analysis = makeAnalysis();
    (analysis.symbol as any).signature = undefined;
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).not.toContain('class="sig-toggle-btn"');
    expect(html).not.toContain('id="sig-panel"');
  });

  // ── Collapsible sections ──────────────────────────────────────────────────

  it('renders sections as <details> elements open by default', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    const openCount = (html.match(/<details class="section" open>/g) ?? []).length;
    // Risk and Architecture open by default; Dependencies and Git History are closed
    expect(openCount).toBe(2);
  });

  // ── Section ordering ──────────────────────────────────────────────────────

  it('renders Risk section before Architecture section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    const riskIdx = html.indexOf('risk-badge');
    const archIdx = html.indexOf('>Architecture<');
    expect(riskIdx).toBeLessThan(archIdx);
  });

  // ── Clickable import chips ────────────────────────────────────────────────

  it('renders a clickable chip--link button for imports that match a dependsOn file path', () => {
    const analysis = makeAnalysis({
      static: { imports: ['./utils', 'fs'], exports: [] },
      dependencies: {
        dependsOn: [{ name: './utils', filePath: '/repo/src/utils.ts', kind: 'import' }],
        usedBy: [],
      },
    });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('chip--link');
    expect(html).toContain('data-file="/repo/src/utils.ts"');
  });

  it('renders a plain chip span for imports without a known file path', () => {
    const analysis = makeAnalysis({
      static: { imports: ['fs'], exports: [] },
      dependencies: { dependsOn: [], usedBy: [] },
    });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    // 'fs' has no depFileMap entry → plain span, not button
    expect(html).not.toContain('chip--link');
    expect(html).toContain('class="chip"');
  });

  // ── Architecture visualizations ───────────────────────────────────────────

  it('renders dependency flow SVG with center symbol and expand buttons', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('dep-graph-svg');
    expect(html).toContain('Dependency Flow');
    expect(html).toContain('dep-graph-node--center');
    expect(html).toContain('data-action="expandNode"');
    expect(html).toContain('data-symbol-name="processPayment"');
    expect(html).toContain('api/routes.ts');
  });

  it('merges duplicate dependsOn file paths into one graph chip with count badge', () => {
    const analysis = makeAnalysis({
      dependencies: {
        dependsOn: [
          { name: 'foo', filePath: '/repo/src/utils.ts', kind: 'import' },
          { name: 'bar', filePath: '/repo/src/utils.ts', kind: 'import' },
        ],
        usedBy: [],
      },
    });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('dep-graph-count">2</span>');
    expect(html).toContain('title="Imported as: foo, bar"');
    const graphStart = html.indexOf('id="dep-graph-svg"');
    const graphEnd = html.indexOf('</svg>', graphStart);
    const graphHtml = html.slice(graphStart, graphEnd);
    expect(graphHtml.match(/dep-graph-node--dep" data-file="\/repo\/src\/utils.ts"/g)).toHaveLength(1);
  });

  it('omits graph count badge when a file appears only once', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).not.toContain('dep-graph-count');
  });

  it('renders change coupling ranked list at the bottom of Git History', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).toContain('Change Coupling');
    expect(html).toContain('cochange-row');
    expect(html).toContain('cochange-rank');
    expect(html).toContain('8 commits');
    expect(html).not.toContain('cochange-bar');
    const commitsIdx = html.indexOf('Recent Commits');
    const couplingIdx = html.indexOf('Change Coupling');
    expect(commitsIdx).toBeGreaterThan(-1);
    expect(couplingIdx).toBeGreaterThan(commitsIdx);
  });

  it('renders dependency flow before Imports in Architecture section', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    const flowIdx = html.indexOf('Dependency Flow');
    const importsIdx = html.indexOf('>Imports<');
    const archIdx = html.indexOf('>Architecture<');
    expect(flowIdx).toBeGreaterThan(archIdx);
    expect(flowIdx).toBeLessThan(importsIdx);
    expect(html).toContain('arch-chips-block');
  });

  it('omits change coupling heatmap when coChangedWith is empty', () => {
    const analysis = makeAnalysis({ git: { commitCount: 0, recentCommits: [], coChangedWith: [] } });
    const html = renderTemplate(analysis, 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).not.toContain('Change Coupling');
    expect(html).not.toContain('cochange-row');
  });

  it('webview script has no syntax errors', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', true);
    const match = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    expect(() => new Function(match![1]!)).not.toThrow();
  });

  // ── No metrics bar ────────────────────────────────────────────────────────

  it('does not render a top-level metrics/stats bar', () => {
    const html = renderTemplate(makeAnalysis(), 'style.css', 'vscode-webview-resource:', 'testnonce', false);
    expect(html).not.toContain('metrics-bar');
    expect(html).not.toContain('metric-card');
  });
});
