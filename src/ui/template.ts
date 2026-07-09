import type { SymbolAnalysis, DependencyRef, RiskAssessment, RiskLevel } from '../models/analysis';
import type { GitHistory, GitCommitRef } from '../models/git';

const MAX_USED_BY_DISPLAY = 50;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

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
  const nameCol = (symbol.location.nameColumn ?? 0) + 1;

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
    <div class="header-main">
      <div class="header-identity">
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
          ${symbol.signature
            ? `<button class="sig-toggle-btn" data-action="toggleSig" title="View full signature">sig ▾</button>`
            : ''}
        </div>
        ${symbol.signature
          ? `<div class="sig-panel" id="sig-panel"><code class="sig-code">${escHtml(symbol.signature)}</code></div>`
          : ''}
      </div>
      ${renderHeaderAiButton(hasApiKey)}
    </div>
  </div>

  <!-- ── Quick metrics bar ── -->
  ${renderQuickMetrics(dependencies.usedBy.length, dependencies.dependsOn.length, git)}

  <!-- ── AI output panel (revealed on demand) ── -->
  <div class="ai-result-panel" id="ai-result-panel">
    <button type="button" class="ai-result-panel-bar" id="ai-panel-toggle" aria-expanded="true">
      <span class="ai-result-panel-title">Engineering Summary</span>
    </button>
    <div id="ai-output" class="ai-output-body"></div>
  </div>

  <!-- ── Risk (top) ── -->
  ${renderRiskSection(risk)}

  <!-- ── Architecture ── -->
  ${renderArchitectureSection(stat, dependencies.dependsOn, dependencies.usedBy, symbolLabel)}

  <!-- ── Git History ── -->
  ${renderGitSection(git)}

  <div class="footer">Analyzed at ${escHtml(analyzedDate)}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.action === 'expandNode') {
        e.preventDefault();
        const filePath = target.dataset.file;
        const depGraph = document.getElementById('dep-graph');
        const symbolName = depGraph ? depGraph.dataset.symbolName : '';
        if (!filePath || !symbolName) return;
        const excludePaths = collectGraphPaths();
        target.disabled = true;
        target.textContent = '\\u2026';
        vscode.postMessage({ type: 'expandNode', filePath, symbolName, excludePaths });
        return;
      }
      if (target.dataset.action) return;
      const filePath = target.dataset.file;
      if (!filePath) return;
      e.preventDefault();
      const line = target.dataset.line ? parseInt(target.dataset.line, 10) : undefined;
      vscode.postMessage({ type: 'openFile', filePath, line });
    });

    function collectGraphPaths() {
      const paths = [];
      document.querySelectorAll('[data-file]').forEach((el) => {
        const p = el.dataset.file;
        if (p) paths.push(p);
      });
      return paths;
    }

    const depGraphSvg = document.getElementById('dep-graph-svg');

    function shortPathClient(p) {
      const parts = String(p).replace(/\\\\/g, '/').split('/');
      return parts.slice(-2).join('/');
    }

    function appendExpansionColumn(payload) {
      if (!depGraphSvg || !payload || !payload.callers || payload.callers.length === 0) return;
      const parentFilePath = payload.parentFilePath;
      const expandBtn = document.querySelector('.dep-graph-expand[data-file="' + parentFilePath.replace(/"/g, '\\\\"') + '"]');
      if (expandBtn) {
        expandBtn.textContent = '\\u2713';
      }
      if (depGraphSvg.querySelector('[data-expansion-for="' + parentFilePath.replace(/"/g, '\\\\"') + '"]')) return;

      const parentY = expandBtn ? parseInt(expandBtn.getAttribute('data-node-y') || '60', 10) : 60;
      const svgW = parseInt(depGraphSvg.getAttribute('width') || '560', 10);
      const svgH = parseInt(depGraphSvg.getAttribute('height') || '120', 10);

      if (!depGraphSvg.dataset.expandedWidth) {
        depGraphSvg.setAttribute('width', String(svgW + 140));
        depGraphSvg.setAttribute('viewBox', '-140 0 ' + (svgW + 140) + ' ' + svgH);
        depGraphSvg.dataset.expandedWidth = '1';
      }

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-expansion-for', parentFilePath);

      payload.callers.forEach(function(caller, i) {
        const spread = payload.callers.length > 1 ? (payload.callers.length - 1) * 22 : 0;
        const y = parentY - spread / 2 + i * 22;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'dep-graph-edge dep-graph-edge--expand');
        path.setAttribute('d', 'M -10,' + y + ' C 20,' + y + ' 40,' + parentY + ' 70,' + parentY);
        path.setAttribute('fill', 'none');
        g.appendChild(path);

        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('x', '-132');
        fo.setAttribute('y', String(y - 14));
        fo.setAttribute('width', '120');
        fo.setAttribute('height', '28');
        const label = esc(shortPathClient(caller.filePath));
        fo.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo"><button type="button" class="dep-graph-node dep-graph-node--caller" data-file="' + esc(caller.filePath) + '">' + label + '</button></div>';
        g.appendChild(fo);
      });

      depGraphSvg.appendChild(g);
    }

    const aiBtn = document.getElementById('ai-btn');
    const aiPanel = document.getElementById('ai-result-panel');
    const aiOutput = document.getElementById('ai-output');
    const aiPanelToggle = document.getElementById('ai-panel-toggle');

    if (aiPanel) aiPanel.style.display = 'none';

    if (aiBtn && aiPanel && aiOutput) {
      aiBtn.addEventListener('click', () => {
        aiBtn.disabled = true;
        aiPanel.style.display = 'block';
        if (aiPanelToggle) aiPanelToggle.setAttribute('aria-expanded', 'true');
        aiOutput.style.display = 'block';
        aiOutput.innerHTML = '<span class="ai-loading">Thinking\u2026</span>';
        aiPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        vscode.postMessage({ type: 'explainWithAI' });
      });
    }

    if (aiPanelToggle && aiOutput) {
      aiPanelToggle.addEventListener('click', () => {
        const open = aiPanelToggle.getAttribute('aria-expanded') === 'true';
        const next = !open;
        aiPanelToggle.setAttribute('aria-expanded', String(next));
        aiOutput.style.display = next ? 'block' : 'none';
        aiPanelToggle.classList.toggle('ai-panel-bar--collapsed', !next);
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'aiResult' && aiOutput) {
        aiOutput.innerHTML = renderAiMarkdown(msg.payload);
        if (aiBtn) aiBtn.disabled = false;
      } else if (msg.type === 'aiError' && aiOutput) {
        aiOutput.innerHTML = '<div class="ai-error">\u26a0\ufe0f ' + esc(msg.payload) + '</div>';
        if (aiBtn) aiBtn.disabled = false;
      } else if (msg.type === 'nodeExpanded') {
        appendExpansionColumn(msg.payload);
      }
    });

    function renderAiMarkdown(text) {
      const lines = String(text).split('\\n');
      let html = '';
      let inList = false;
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (/^#{1,3}\\s/.test(line)) {
          if (inList) { html += '</ul>'; inList = false; }
          const lvl = line.match(/^(#+)/)[1].length;
          const tag = lvl === 1 ? 'h3' : 'h4';
          html += '<' + tag + ' class="ai-heading">' + esc(line.replace(/^#+\\s/, '')) + '</' + tag + '>';
        } else if (/^\\s*[-*]\\s/.test(line)) {
          if (!inList) { html += '<ul class="ai-list">'; inList = true; }
          html += '<li>' + esc(line.replace(/^\\s*[-*]\\s/, '')) + '</li>';
        } else if (/^\\s*\\d+\\.\\s/.test(line)) {
          if (!inList) { html += '<ol class="ai-list">'; inList = true; }
          html += '<li>' + esc(line.replace(/^\\s*\\d+\\.\\s/, '')) + '</li>';
        } else if (line.trim() === '') {
          if (inList) { html += '</ul>'; inList = false; }
          html += '';
        } else {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<p class="ai-para">' + esc(line).replace(/\`([^\`]+)\`/g, '<code class="ai-code">$1</code>') + '</p>';
        }
      }
      if (inList) html += '</ul>';
      return '<div class="ai-result">' + html + '</div>';
    }

    // Signature toggle
    const sigBtn = document.querySelector('[data-action="toggleSig"]');
    const sigPanel = document.getElementById('sig-panel');
    if (sigBtn && sigPanel) {
      let sigOpen = false;
      sigPanel.style.display = 'none';
      sigBtn.addEventListener('click', function(e) {
        e.preventDefault();
        sigOpen = !sigOpen;
        sigPanel.style.display = sigOpen ? 'block' : 'none';
        sigBtn.classList.toggle('sig-toggle-btn--open', sigOpen);
        sigBtn.textContent = sigOpen ? 'sig \u25b4' : 'sig \u25be';
      });
    }

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

function renderQuickMetrics(
  referencedBy: number,
  dependenciesCount: number,
  git: GitHistory,
): string {
  const lastModRelative = git.lastModified ? relativeTime(git.lastModified.date) : '—';
  const lastModDate = git.lastModified
    ? new Date(git.lastModified.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return `<div class="quick-metrics">
  <div class="qm-card">
    <div class="qm-label">Referenced By</div>
    <div class="qm-value">${referencedBy}</div>
    <div class="qm-sub">${referencedBy === 1 ? 'file' : 'files'}</div>
  </div>
  <div class="qm-card">
    <div class="qm-label">Dependencies</div>
    <div class="qm-value">${dependenciesCount}</div>
    <div class="qm-sub">imports</div>
  </div>
  <div class="qm-card">
    <div class="qm-label">Commits</div>
    <div class="qm-value">${git.commitCount}</div>
    <div class="qm-sub">commits</div>
  </div>
  <div class="qm-card">
    <div class="qm-label">Last Modified</div>
    <div class="qm-value qm-value--em">${escHtml(lastModRelative)}</div>
    <div class="qm-sub">${escHtml(lastModDate)}</div>
  </div>
</div>`;
}

function renderArchitectureSection(
  stat: SymbolAnalysis['static'],
  dependsOn: DependencyRef[],
  usedBy: DependencyRef[],
  symbolName: string,
): string {
  // Build a lookup: import name → filePath from dependsOn (for clickable chips)
  const depFileMap = new Map<string, string>();
  for (const d of dependsOn) {
    depFileMap.set(d.name, d.filePath);
  }

  // Imports row — chips (clickable when file path is known)
  const importChips = stat.imports.length > 0
    ? stat.imports.map((imp) => {
        const filePath = depFileMap.get(imp);
        if (filePath) {
          return `<button class="chip chip--link" data-file="${escAttr(filePath)}" title="Open ${escAttr(imp)}">${escHtml(imp)}</button>`;
        }
        return `<span class="chip">${escHtml(imp)}</span>`;
      }).join('')
    : '<span class="empty-inline">none</span>';

  // Exports row — chips (non-clickable; they live in the current file)
  const exportChips = stat.exports.length > 0
    ? stat.exports.map((exp) => `<span class="chip chip--export">${escHtml(exp)}</span>`).join('')
    : '<span class="empty-inline">none</span>';

  const importsRow = `<div class="arch-row">
  <span class="arch-label">Imports</span>
  <div class="chip-group">${importChips}</div>
</div>`;

  const exportsRow = `<div class="arch-row">
  <span class="arch-label">Exports</span>
  <div class="chip-group">${exportChips}</div>
</div>`;

  // Depends On — collapsible list of import deps
  const dependsOnBody = dependsOn.length > 0
    ? `<ul class="dep-list">${dependsOn.map((d) =>
        `<li class="dep-item">
          <span class="dep-kind-badge">${escHtml(d.kind)}</span>
          <button class="dep-file-link" data-file="${escAttr(d.filePath)}">${escHtml(d.name)}</button>
        </li>`).join('')}</ul>`
    : '<p class="empty">No outgoing dependencies detected.</p>';

  // Used By — collapsible list of references
  const visibleUsedBy = usedBy.slice(0, MAX_USED_BY_DISPLAY);
  const overflow = usedBy.length >= MAX_USED_BY_DISPLAY
    ? `<p class="overflow-notice">Showing first ${MAX_USED_BY_DISPLAY} references. There may be more.</p>`
    : '';
  const usedByBody = usedBy.length > 0
    ? `<ul class="dep-list">${visibleUsedBy.map((d) =>
        `<li class="dep-item">
          <button class="dep-file-link" data-file="${escAttr(d.filePath)}">${escHtml(shortPath(d.filePath))}</button>
        </li>`).join('')}</ul>${overflow}`
    : '<p class="empty">No references found in the workspace.</p>';

  const totalDeps = dependsOn.length + usedBy.length;
  const dependencyGraph = renderDependencyGraph(dependsOn, usedBy, symbolName);

  return `<details class="section" open>
  <summary class="section-header">Architecture</summary>
  <div class="section-body">
    ${dependencyGraph}
    <div class="arch-chips-block">
      ${importsRow}
      ${exportsRow}
    </div>
  </div>
</details>

<details class="section">
  <summary class="section-header">Dependencies${totalDeps > 0 ? ` <span class="count-badge">${totalDeps}</span>` : ''}</summary>
  <div class="section-body">
    <div class="dep-subsection">
      <div class="dep-subsection-label">Depends On${dependsOn.length > 0 ? ` <span class="count-badge">${dependsOn.length}</span>` : ''}</div>
      ${dependsOnBody}
    </div>
    <div class="dep-subsection">
      <div class="dep-subsection-label">Used By${usedBy.length > 0 ? ` <span class="count-badge">${usedBy.length}</span>` : ''}</div>
      ${usedByBody}
    </div>
  </div>
</details>`;
}

const MAX_GRAPH_NODES = 6;
const GRAPH_WIDTH = 560;
const GRAPH_ROW_HEIGHT = 50;
const GRAPH_PAD_TOP = 36;

function renderDependencyGraph(
  dependsOn: DependencyRef[],
  usedBy: DependencyRef[],
  symbolName: string,
): string {
  if (dependsOn.length === 0 && usedBy.length === 0) {
    return '';
  }

  const leftNodes = usedBy.slice(0, MAX_GRAPH_NODES);
  const rightNodes = dependsOn.slice(0, MAX_GRAPH_NODES);
  const leftOverflow = usedBy.length - leftNodes.length;
  const rightOverflow = dependsOn.length - rightNodes.length;

  const maxRows = Math.max(leftNodes.length, rightNodes.length, 1);
  const height = Math.max(GRAPH_PAD_TOP + maxRows * GRAPH_ROW_HEIGHT + 20, 120);
  const centerY = height / 2;
  const centerLabel = truncateGraphLabel(symbolName, 24);

  const centerX = 200;
  const centerW = 160;
  const parts: string[] = [];

  for (let i = 0; i < leftNodes.length; i++) {
    const y = GRAPH_PAD_TOP + i * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
    parts.push(
      `<path class="dep-graph-edge dep-graph-edge--in" d="M 130,${y} C 165,${y} 165,${centerY} ${centerX},${centerY}" fill="none"/>`,
    );
  }

  for (let i = 0; i < rightNodes.length; i++) {
    const y = GRAPH_PAD_TOP + i * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
    parts.push(
      `<path class="dep-graph-edge dep-graph-edge--out" d="M ${centerX + centerW},${centerY} C 395,${centerY} 395,${y} 430,${y}" fill="none"/>`,
    );
  }

  parts.push(
    `<rect class="dep-graph-center" x="${centerX}" y="${centerY - 16}" width="${centerW}" height="32" rx="4"/>`,
    `<text class="dep-graph-center-label" x="${centerX + centerW / 2}" y="${centerY + 5}" text-anchor="middle">${escHtml(centerLabel)}</text>`,
  );

  leftNodes.forEach((node, i) => {
    const y = GRAPH_PAD_TOP + i * GRAPH_ROW_HEIGHT;
    const nodeY = y + GRAPH_ROW_HEIGHT / 2;
    const label = escHtml(truncateGraphLabel(shortPath(node.filePath)));
    parts.push(`<foreignObject x="8" y="${y}" width="122" height="28">
      <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo">
        <button type="button" class="dep-graph-expand" data-action="expandNode" data-file="${escAttr(node.filePath)}" data-node-y="${nodeY}" title="Expand callers">+</button>
        <button type="button" class="dep-graph-node dep-graph-node--caller" data-file="${escAttr(node.filePath)}">${label}</button>
      </div>
    </foreignObject>`);
  });

  rightNodes.forEach((node, i) => {
    const y = GRAPH_PAD_TOP + i * GRAPH_ROW_HEIGHT;
    const external = isExternalModule(node.filePath);
    const label = escHtml(truncateGraphLabel(external ? node.name : shortPath(node.filePath)));
    if (external) {
      parts.push(`<foreignObject x="432" y="${y}" width="120" height="28">
        <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo">
          <span class="dep-graph-node dep-graph-node--external">${label}</span>
        </div>
      </foreignObject>`);
    } else {
      parts.push(`<foreignObject x="432" y="${y}" width="120" height="28">
        <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo">
          <button type="button" class="dep-graph-node dep-graph-node--dep" data-file="${escAttr(node.filePath)}">${label}</button>
        </div>
      </foreignObject>`);
    }
  });

  if (leftOverflow > 0) {
    const y = GRAPH_PAD_TOP + leftNodes.length * GRAPH_ROW_HEIGHT + 8;
    parts.push(`<text class="dep-graph-overflow" x="70" y="${y}" text-anchor="middle">+${leftOverflow} more</text>`);
  }
  if (rightOverflow > 0) {
    const y = GRAPH_PAD_TOP + rightNodes.length * GRAPH_ROW_HEIGHT + 8;
    parts.push(`<text class="dep-graph-overflow" x="490" y="${y}" text-anchor="middle">+${rightOverflow} more</text>`);
  }

  return `<div class="dep-subsection dep-subsection--flow">
  <div class="dep-subsection-label">Dependency Flow</div>
  <div class="dep-graph-wrap" id="dep-graph" data-symbol-name="${escAttr(symbolName)}">
    <svg class="dep-graph-svg" id="dep-graph-svg" width="${GRAPH_WIDTH}" height="${height}" viewBox="0 0 ${GRAPH_WIDTH} ${height}" aria-label="Dependency flow diagram">
      ${parts.join('\n      ')}
    </svg>
  </div>
</div>`;
}

function renderCoChangeHeatmap(git: GitHistory): string {
  const items = git.coChangedWith ?? [];
  if (items.length === 0) return '';

  const maxCount = items[0]!.count;
  const rows = items.map((item) => {
    const pct = Math.round((item.count / maxCount) * 100);
    return `<button type="button" class="cochange-row" data-file="${escAttr(item.filePath)}">
  <span class="cochange-label">${escHtml(item.relativePath)}</span>
  <span class="cochange-bar-wrap"><span class="cochange-bar" style="width:${pct}%"></span></span>
  <span class="cochange-count">${item.count}</span>
</button>`;
  }).join('');

  return `<div class="dep-subsection">
  <div class="dep-subsection-label">Change Coupling</div>
  <div class="cochange-list">${rows}</div>
</div>`;
}

function truncateGraphLabel(label: string, max = 18): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function isExternalModule(filePath: string): boolean {
  return !filePath.includes('/') && !filePath.endsWith('.ts') && !filePath.endsWith('.tsx');
}

function renderGitSection(git: GitHistory): string {
  const coChangeHeatmap = renderCoChangeHeatmap(git);

  if (git.commitCount === 0) {
    return `<details class="section">
  <summary class="section-header">Git History</summary>
  <div class="section-body">
    <p class="empty">No Git history found for this file.</p>
    ${coChangeHeatmap}
  </div>
</details>`;
  }

  const createdCard = gitMetaCard(
    'Created',
    git.firstIntroduced ? formatDate(git.firstIntroduced.date) : '—',
    git.firstIntroduced ? `by ${git.firstIntroduced.author}` : '',
  );
  const lastModCard = gitMetaCard(
    'Last Modified',
    git.lastModified ? formatDate(git.lastModified.date) : '—',
    git.lastModified ? relativeTime(git.lastModified.date) : '',
  );
  const authorCard = gitMetaCard(
    'Author',
    git.primaryAuthor ? git.primaryAuthor.name : '—',
    git.primaryAuthor ? `${Math.round(git.primaryAuthor.percentage * 100)}%` : '',
  );
  const span = commitTimespan(git);
  const commitsCard = gitMetaCard('Commits', String(git.commitCount), span ? `over ${span}` : '');

  const commitsHtml = git.recentCommits.length > 0
    ? `<div class="commits-label">Recent Commits</div>
       <div class="commits-block">${git.recentCommits.map((c, i) => renderCommitRow(c, i)).join('')}</div>`
    : '';

  return `<details class="section">
  <summary class="section-header">Git History</summary>
  <div class="section-body">
    <div class="git-meta-grid">
      ${createdCard}${lastModCard}${authorCard}${commitsCard}
    </div>
    ${commitsHtml}
    ${coChangeHeatmap}
  </div>
</details>`;
}

function gitMetaCard(label: string, value: string, sub: string): string {
  return `<div class="git-meta-card">
  <div class="git-meta-label">${escHtml(label)}</div>
  <div class="git-meta-value">${escHtml(value)}</div>
  ${sub ? `<div class="git-meta-sub">${escHtml(sub)}</div>` : ''}
</div>`;
}

function commitTimespan(git: GitHistory): string {
  if (!git.firstIntroduced || !git.lastModified) return '';
  const days = Math.round(
    (new Date(git.lastModified.date).getTime() - new Date(git.firstIntroduced.date).getTime()) /
      86_400_000,
  );
  if (days === 0) return '1 day';
  return `${days} day${days === 1 ? '' : 's'}`;
}

function renderRiskSection(risk: RiskAssessment): string {
  const r = 22;
  const circ = +(2 * Math.PI * r).toFixed(1);
  const offset = +(circ * (1 - risk.score / 100)).toFixed(1);
  const color = riskSvgColor(risk.level);

  const gauge = `<svg class="risk-gauge-svg" width="60" height="60" viewBox="0 0 52 52"
    aria-label="Risk score ${risk.score} out of 100">
  <circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="3.5" opacity="0.18"/>
  <circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="3.5"
    stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
    stroke-linecap="round" transform="rotate(-90 26 26)"/>
  <text x="26" y="24" text-anchor="middle" fill="${color}" font-size="11" font-weight="600" font-family="system-ui,sans-serif">${risk.score}</text>
  <text x="26" y="33" text-anchor="middle" fill="${color}" font-size="7" opacity="0.6" font-family="system-ui,sans-serif">/100</text>
</svg>`;

  const reasons = risk.reasons.length > 0
    ? risk.reasons.map((r) =>
        `<li class="reason-item"><span class="reason-icon">${reasonIcon(r)}</span>${escHtml(r)}</li>`
      ).join('')
    : `<li class="reason-item empty">No specific risk factors identified.</li>`;

  return `<details class="section" open>
  <summary class="section-header">Risk</summary>
  <div class="section-body">
    <div class="risk-content">
      <div class="risk-left">
        <span class="risk-badge risk-badge--${risk.level}">
          <span class="risk-dot"></span>${escHtml(capitalize(risk.level))}
        </span>
        <ul class="reason-list">${reasons}</ul>
      </div>
      <div class="risk-gauge">${gauge}</div>
    </div>
  </div>
</details>`;
}

function renderHeaderAiButton(hasApiKey: boolean): string {
  if (hasApiKey) {
    return `<div class="header-actions">
      <button class="ai-button ai-button--header" id="ai-btn" title="Explain with AI">✦ AI</button>
    </div>`;
  }
  return `<div class="header-actions">
    <div class="ai-locked-wrap">
      <button class="ai-button ai-button--header ai-button--locked" id="ai-btn" disabled aria-describedby="ai-locked-tip" title="No API key set">✦ AI</button>
      <div class="ai-locked-tip" id="ai-locked-tip" role="tooltip">
        <strong>No API key set</strong><br>
        Run <code>Arkaeo: Set Anthropic API Key</code>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Commit row
// ---------------------------------------------------------------------------

const HASH_COLORS = ['hash-teal', 'hash-purple', 'hash-green'] as const;

function renderCommitRow(c: GitCommitRef, index: number): string {
  const colorClass = HASH_COLORS[index % HASH_COLORS.length];
  return `<div class="commit-row">
  <span class="commit-hash ${colorClass}">${escHtml(c.hash.slice(0, 7))}</span>
  <span class="commit-author-name">${escHtml(c.author)}</span>
  <span class="commit-message">${escHtml(c.message)}</span>
  <span class="commit-age">${escHtml(relativeTime(c.date))}</span>
</div>`;
}

// ---------------------------------------------------------------------------
// Time / date helpers
// ---------------------------------------------------------------------------

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Risk helpers
// ---------------------------------------------------------------------------

function reasonIcon(reason: string): string {
  const lc = reason.toLowerCase();
  if (lc.includes('todo') || lc.includes('fixme') || lc.includes('hack')) return '○';
  if (lc.includes('modif') || lc.includes('chang') || lc.includes('recent')) return '↑';
  if (lc.includes('author') || lc.includes('maintainer') || lc.includes('single')) return '◎';
  return '·';
}

function riskSvgColor(level: RiskLevel): string {
  if (level === 'low') return '#4caf50';
  if (level === 'medium') return '#e5c07b';
  return '#e06c75';
}
// Keep exported for tests that may reference it indirectly
void riskSvgColor;

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
