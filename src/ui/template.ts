import type { SymbolAnalysis, DependencyRef, RiskLevel } from '../models/analysis';

/**
 * Renders the full Webview HTML for a given SymbolAnalysis.
 *
 * @param analysis  - The merged analysis result.
 * @param styleUri  - VS Code Webview URI for styles.css.
 * @param nonce     - CSP nonce for the inline script.
 * @param hasApiKey - Whether the user has an OpenAI API key configured.
 */
export function renderTemplate(
  analysis: SymbolAnalysis,
  styleUri: string,
  nonce: string,
  hasApiKey: boolean,
): string {
  const { symbol, static: stat, dependencies, git, risk } = analysis;

  const symbolLabel = symbol.containingClass
    ? `${symbol.containingClass}.${symbol.name}`
    : symbol.name;

  const analyzedDate = new Date(analysis.analyzedAt).toLocaleString();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${styleUri}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Arkaeo — ${escHtml(symbolLabel)}</title>
</head>
<body>

  <!-- ── Header ── -->
  <div class="arkaeo-header">
    <div class="symbol-kind">${escHtml(symbol.kind)}</div>
    <h1>${escHtml(symbolLabel)}</h1>
  </div>

  <!-- ── Symbol ── -->
  <div class="section">
    <div class="section-title">Symbol</div>
    ${kvRow('Name', escHtml(symbol.name))}
    ${kvRow('Kind', escHtml(symbol.kind))}
    ${symbol.containingClass ? kvRow('Class', escHtml(symbol.containingClass)) : ''}
    ${symbol.signature ? kvRow('Signature', `<span class="mono">${escHtml(symbol.signature)}</span>`) : ''}
    ${kvRow('Location', fileLink(symbol.location.relativePath, symbol.location.filePath, symbol.location.startLine))}
    ${kvRow('Lines', `${symbol.location.startLine} – ${symbol.location.endLine}`)}
  </div>

  <!-- ── Static Analysis ── -->
  <div class="section">
    <div class="section-title">Architecture</div>
    ${kvRow('Imports', tagList(stat.imports, 'No imports'))}
    ${kvRow('Exports', tagList(stat.exports, 'None'))}
    ${symbol.kind === 'class' && stat.methods ? kvRow('Methods', tagList(stat.methods, 'None')) : ''}
  </div>

  <!-- ── Depends On ── -->
  <div class="section">
    <div class="section-title">Depends On</div>
    ${renderDepList(dependencies.dependsOn, 'No outgoing dependencies detected')}
  </div>

  <!-- ── Used By ── -->
  <div class="section">
    <div class="section-title">Used By</div>
    ${renderUsedBy(dependencies.usedBy)}
  </div>

  <!-- ── Git History ── -->
  <div class="section">
    <div class="section-title">Git History</div>
    ${git.commitCount === 0
      ? '<p class="empty">No Git history found for this file.</p>'
      : `
      ${git.firstIntroduced ? kvRow('Created', `${escHtml(git.firstIntroduced.date.slice(0, 10))} by ${escHtml(git.firstIntroduced.author)}`) : ''}
      ${git.lastModified ? kvRow('Last Modified', `${escHtml(git.lastModified.date.slice(0, 10))} by ${escHtml(git.lastModified.author)}`) : ''}
      ${git.primaryAuthor ? kvRow('Primary Author', `${escHtml(git.primaryAuthor.name)} (${Math.round(git.primaryAuthor.percentage * 100)}%)`) : ''}
      ${kvRow('Commits', String(git.commitCount))}
      ${git.recentCommits.length > 0 ? `
        <div class="kv-row">
          <span class="kv-label">Recent</span>
          <ul class="commit-list">
            ${git.recentCommits.map(renderCommit).join('')}
          </ul>
        </div>` : ''}
    `}
  </div>

  <!-- ── Risk ── -->
  <div class="section">
    <div class="section-title">Risk</div>
    <div class="kv-row">
      <span class="kv-label">Level</span>
      <span class="risk-badge ${riskClass(risk.level)}">${escHtml(risk.level)}</span>
    </div>
    ${risk.reasons.length > 0 ? `
      <ul class="reason-list">
        ${risk.reasons.map((r) => `<li>${escHtml(r)}</li>`).join('')}
      </ul>` : '<p class="empty" style="margin-top:4px">No specific risk factors identified.</p>'}
  </div>

  <!-- ── AI Insight ── -->
  ${hasApiKey ? renderAiSection() : ''}

  <div class="footer">Analyzed at ${escHtml(analyzedDate)}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Open file on link click
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement) && !(target instanceof HTMLAnchorElement)) return;
      const filePath = target.dataset.file;
      const line = target.dataset.line ? parseInt(target.dataset.line, 10) : undefined;
      if (!filePath) return;
      e.preventDefault();
      vscode.postMessage({ type: 'openFile', filePath, line });
    });

    // AI button
    const aiBtn = document.getElementById('ai-btn');
    const aiOutput = document.getElementById('ai-output');
    if (aiBtn && aiOutput) {
      aiBtn.addEventListener('click', () => {
        aiBtn.disabled = true;
        aiOutput.innerHTML = '<span class="ai-loading">Thinking…</span>';
        vscode.postMessage({ type: 'explainWithAI' });
      });
    }

    // Receive messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!aiOutput) return;
      if (msg.type === 'aiResult') {
        aiOutput.innerHTML = '<div class="ai-output">' + escapeHtml(msg.payload) + '</div>';
        if (aiBtn) aiBtn.disabled = false;
      } else if (msg.type === 'aiError') {
        aiOutput.innerHTML = '<div class="ai-error">Error: ' + escapeHtml(msg.payload) + '</div>';
        if (aiBtn) aiBtn.disabled = false;
      }
    });

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderDepList(deps: DependencyRef[], emptyMsg: string): string {
  if (deps.length === 0) {
    return `<p class="empty">${escHtml(emptyMsg)}</p>`;
  }
  const items = deps
    .map(
      (d) =>
        `<li class="dep-item">
          <span class="dep-kind">${escHtml(d.kind)}</span>
          ${fileLink(d.name, d.filePath)}
        </li>`,
    )
    .join('');
  return `<ul class="dep-list">${items}</ul>`;
}

function renderUsedBy(deps: DependencyRef[]): string {
  if (deps.length === 0) {
    return '<p class="empty">No references found in the workspace.</p>';
  }
  const items = deps
    .map(
      (d) =>
        `<li class="dep-item">
          ${fileLink(shortPath(d.filePath), d.filePath)}
        </li>`,
    )
    .join('');
  const overflow =
    deps.length >= 50
      ? '<p class="overflow-notice">Showing first 50 references. There may be more.</p>'
      : '';
  return `<ul class="dep-list">${items}</ul>${overflow}`;
}

function renderCommit(c: { hash: string; date: string; message: string; author: string }): string {
  return `<li class="commit-item">
    <span class="commit-hash">${escHtml(c.hash.slice(0, 7))}</span>
    <div class="commit-msg">${escHtml(c.message)}</div>
    <div class="commit-meta">${escHtml(c.author)} · ${escHtml(c.date.slice(0, 10))}</div>
  </li>`;
}

function renderAiSection(): string {
  return `<div class="section ai-section">
    <div class="section-title">AI Insight</div>
    <button class="ai-button" id="ai-btn">Explain with AI</button>
    <div id="ai-output"></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function kvRow(label: string, value: string): string {
  return `<div class="kv-row">
    <span class="kv-label">${label}</span>
    <span class="kv-value">${value}</span>
  </div>`;
}

function tagList(items: string[], emptyMsg: string): string {
  if (items.length === 0) return `<span class="empty">${escHtml(emptyMsg)}</span>`;
  return `<ul class="tag-list">${items.map((i) => `<li class="tag">${escHtml(i)}</li>`).join('')}</ul>`;
}

function fileLink(label: string, filePath: string, line?: number): string {
  const lineAttr = line !== undefined ? ` data-line="${line}"` : '';
  return `<button class="file-link" data-file="${escAttr(filePath)}"${lineAttr}>${escHtml(label)}</button>`;
}

function riskClass(level: RiskLevel): string {
  return `risk-${level}`;
}

/** Shorten long absolute paths to the last 2 segments for display. */
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
