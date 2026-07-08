import type { SymbolAnalysis, DependencyRef, RiskLevel } from '../models/analysis';

/** Sections with more items than this are collapsed by default. */
const COLLAPSE_THRESHOLD = 5;

export function renderTemplate(
  analysis: SymbolAnalysis,
  styleUri: string,
  cspSource: string,
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
    content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Arkaeo — ${escHtml(symbolLabel)}</title>
</head>
<body>

  <!-- ── Header ── -->
  <div class="header">
    <div class="header-eyebrow">
      <span class="kind-badge kind-${escHtml(symbol.kind)}">${escHtml(symbol.kind)}</span>
      ${symbol.containingClass
        ? `<span class="header-class">${escHtml(symbol.containingClass)}</span>`
        : ''}
    </div>
    <h1 class="header-title">${escHtml(symbol.name)}</h1>
    <div class="header-meta">
      <button class="header-location"
        data-file="${escAttr(symbol.location.filePath)}"
        data-line="${symbol.location.startLine}">${escHtml(symbol.location.relativePath)}</button>
      <span class="header-lines">lines ${symbol.location.startLine}–${symbol.location.endLine}</span>
    </div>
    ${symbol.signature
      ? `<div class="header-sig" title="${escAttr(symbol.signature)}">${escHtml(clampSignature(symbol.signature))}</div>`
      : ''}
  </div>

  <!-- ── Architecture ── -->
  ${collapsibleSection('Architecture',
    kvRow('Imports', tagList(stat.imports, 'No imports')) +
    kvRow('Exports', tagList(stat.exports, 'None')) +
    (symbol.kind === 'class' && stat.methods ? kvRow('Methods', tagList(stat.methods, 'None')) : ''),
    false,
  )}

  <!-- ── Depends On ── -->
  ${collapsibleSection(
    `Depends On${dependencies.dependsOn.length > 0 ? ` <span class="count-badge">${dependencies.dependsOn.length}</span>` : ''}`,
    renderDepList(dependencies.dependsOn, 'No outgoing dependencies detected'),
    false,
  )}

  <!-- ── Used By ── -->
  ${collapsibleSection(
    `Used By${dependencies.usedBy.length > 0 ? ` <span class="count-badge">${dependencies.usedBy.length}</span>` : ''}`,
    renderUsedBy(dependencies.usedBy),
    dependencies.usedBy.length > COLLAPSE_THRESHOLD,
  )}

  <!-- ── Git History ── -->
  ${collapsibleSection('Git History',
    git.commitCount === 0
      ? '<p class="empty">No Git history found for this file.</p>'
      : `
        ${git.firstIntroduced
          ? kvRow('Created', `${escHtml(git.firstIntroduced.date.slice(0, 10))} · ${escHtml(git.firstIntroduced.author)}`)
          : ''}
        ${git.lastModified
          ? kvRow('Last Modified', `${escHtml(git.lastModified.date.slice(0, 10))} · ${escHtml(git.lastModified.author)}`)
          : ''}
        ${git.primaryAuthor
          ? kvRow('Primary Author', `${escHtml(git.primaryAuthor.name)} <span style="opacity:0.6">(${Math.round(git.primaryAuthor.percentage * 100)}%)</span>`)
          : ''}
        ${kvRow('Commits', String(git.commitCount))}
        ${git.recentCommits.length > 0
          ? `<div style="margin-top:8px"><ul class="commit-list">${git.recentCommits.map(renderCommit).join('')}</ul></div>`
          : ''}
      `,
    false,
  )}

  <!-- ── Risk ── -->
  ${collapsibleSection('Risk',
    `<div class="risk-row">
      <span class="risk-badge ${riskClass(risk.level)}">
        <span class="risk-dot"></span>${escHtml(risk.level)}
      </span>
    </div>
    ${risk.reasons.length > 0
      ? `<ul class="reason-list">${risk.reasons.map((r) => `<li class="reason-item">${escHtml(r)}</li>`).join('')}</ul>`
      : '<p class="empty">No specific risk factors identified.</p>'}`,
    false,
  )}

  <!-- ── AI Insight ── -->
  ${hasApiKey ? renderAiSection() : ''}

  <div class="footer">Analyzed at ${escHtml(analyzedDate)}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const filePath = target.dataset.file;
      if (!filePath) return;
      e.preventDefault();
      const line = target.dataset.line ? parseInt(target.dataset.line, 10) : undefined;
      vscode.postMessage({ type: 'openFile', filePath, line });
    });

    const aiBtn = document.getElementById('ai-btn');
    const aiOutput = document.getElementById('ai-output');
    if (aiBtn && aiOutput) {
      aiBtn.addEventListener('click', () => {
        aiBtn.disabled = true;
        aiOutput.innerHTML = '<span class="ai-loading">Thinking\u2026</span>';
        vscode.postMessage({ type: 'explainWithAI' });
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!aiOutput) return;
      if (msg.type === 'aiResult') {
        aiOutput.innerHTML = '<div class="ai-output">' + esc(msg.payload) + '</div>';
        if (aiBtn) aiBtn.disabled = false;
      } else if (msg.type === 'aiError') {
        aiOutput.innerHTML = '<div class="ai-error">Error: ' + esc(msg.payload) + '</div>';
        if (aiBtn) aiBtn.disabled = false;
      }
    });

    function esc(str) {
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

/**
 * Wraps content in a <details> element.
 * @param titleHtml - Raw HTML for the summary label (may contain badge spans).
 * @param content   - Inner HTML of the section body.
 * @param collapsed - Whether to render the section collapsed by default.
 */
function collapsibleSection(titleHtml: string, content: string, collapsed: boolean): string {
  const open = collapsed ? '' : ' open';
  return `<details class="section"${open}>
  <summary class="section-title">${titleHtml}</summary>
  <div class="section-body">${content}</div>
</details>`;
}

function renderDepList(deps: DependencyRef[], emptyMsg: string): string {
  if (deps.length === 0) return `<p class="empty">${escHtml(emptyMsg)}</p>`;
  const items = deps
    .map(
      (d) => `<li class="dep-item">
        <span class="dep-kind-badge">${escHtml(d.kind)}</span>
        <button class="dep-file-link" data-file="${escAttr(d.filePath)}">${escHtml(d.name)}</button>
      </li>`,
    )
    .join('');
  return `<ul class="dep-list">${items}</ul>`;
}

function renderUsedBy(deps: DependencyRef[]): string {
  if (deps.length === 0) return '<p class="empty">No references found in the workspace.</p>';
  const items = deps
    .map(
      (d) => `<li class="dep-item">
        <button class="dep-file-link" data-file="${escAttr(d.filePath)}">${escHtml(shortPath(d.filePath))}</button>
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
    <div class="commit-header">
      <span class="commit-hash">${escHtml(c.hash.slice(0, 7))}</span>
      <span class="commit-author">${escHtml(c.author)}</span>
      <span class="commit-date">${escHtml(c.date.slice(0, 10))}</span>
    </div>
    <div class="commit-msg">${escHtml(c.message)}</div>
  </li>`;
}

function renderAiSection(): string {
  return `<details class="section" open>
  <summary class="section-title">AI Insight</summary>
  <div class="section-body">
    <div class="ai-trigger">
      <button class="ai-button" id="ai-btn">&#10024; Explain with AI</button>
    </div>
    <div class="ai-output-wrap" id="ai-output"></div>
  </div>
</details>`;
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
  const tags = items.map((i) => `<li class="tag">${escHtml(i)}</li>`).join('');
  return `<ul class="tag-list">${tags}</ul>`;
}

function riskClass(level: RiskLevel): string {
  return `risk-${level}`;
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

/**
 * Clamps a long signature to 80 chars for display. The full value is preserved
 * in the `title` attribute of the containing element.
 */
function clampSignature(sig: string): string {
  return sig.length > 80 ? sig.slice(0, 77) + '…' : sig;
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
