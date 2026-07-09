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
  ${renderArchitectureSection(stat, dependencies.dependsOn, dependencies.usedBy, symbolLabel, symbol.location.filePath)}

  <!-- ── Git History ── -->
  ${renderGitSection(git)}

  <div class="footer">Analyzed at ${escHtml(analyzedDate)}</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const DEP_GRAPH = {
      PAD_TOP: ${GRAPH_PAD_TOP},
      ROW_GAP: 8,
      LEFT_COL_X: ${DEP_GRAPH_LEFT_COL_X},
      LEFT_COL_W: ${DEP_GRAPH_LEFT_COL_W},
      CENTER_COL_X: ${DEP_GRAPH_CENTER_COL_X},
      CENTER_COL_W: ${DEP_GRAPH_CENTER_COL_W},
      RIGHT_COL_X: ${DEP_GRAPH_RIGHT_COL_X},
      RIGHT_COL_W: ${DEP_GRAPH_RIGHT_COL_W},
      EXPAND_COL_W: ${DEP_GRAPH_EXPAND_COL_W},
      EXPAND_COL_GAP: ${DEP_GRAPH_EXPAND_COL_GAP},
    };

    function graphBezierPath(x1, y1, x2, y2) {
      const mx = (x1 + x2) / 2;
      if (Math.abs(y1 - y2) < 1) {
        const bend = 14;
        return 'M ' + x1 + ',' + y1 + ' C ' + mx + ',' + (y1 - bend) + ' ' + mx + ',' + (y2 + bend) + ' ' + x2 + ',' + y2;
      }
      return 'M ' + x1 + ',' + y1 + ' C ' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
    }

    function toSvgPoint(svg, clientX, clientY) {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: clientX, y: clientY };
      const sp = pt.matrixTransform(ctm.inverse());
      return { x: sp.x, y: sp.y };
    }

    function chipAnchor(svg, chipEl, side) {
      const r = chipEl.getBoundingClientRect();
      const overlap = 1;
      let x = side === 'right' ? r.right - overlap : side === 'left' ? r.left + overlap : r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return toSvgPoint(svg, x, y);
    }

    function colWidthFor(fo) {
      const col = fo.getAttribute('data-graph-col');
      if (col === 'left') return DEP_GRAPH.LEFT_COL_W;
      if (col === 'right') return DEP_GRAPH.RIGHT_COL_W;
      if (col === 'expand') return DEP_GRAPH.EXPAND_COL_W;
      return DEP_GRAPH.CENTER_COL_W;
    }

    function fitForeignObject(fo) {
      const inner = fo.querySelector('.dep-graph-fo');
      if (!inner) return;
      const colW = colWidthFor(fo);
      inner.style.width = colW + 'px';
      const h = inner.scrollHeight;
      fo.setAttribute('width', String(colW));
      fo.setAttribute('height', String(Math.max(h, 20)));
    }

    function findMainCallerChip(svg, filePath) {
      const chips = svg.querySelectorAll('.dep-graph-node--caller[data-file]');
      for (let i = 0; i < chips.length; i++) {
        const chip = chips[i];
        if (chip.dataset.file !== filePath) continue;
        const fo = chip.closest('foreignObject');
        if (fo && fo.querySelector('.dep-graph-expand')) return chip;
      }
      return null;
    }

    function addGraphEdge(g, svg, fromEl, fromSide, toEl, toSide, extraClass) {
      const p1 = chipAnchor(svg, fromEl, fromSide);
      const p2 = chipAnchor(svg, toEl, toSide);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'dep-graph-edge ' + extraClass);
      path.setAttribute('d', graphBezierPath(p1.x, p1.y, p2.x, p2.y));
      path.setAttribute('fill', 'none');
      g.appendChild(path);
    }

    function drawDependencyEdges(svg) {
      let edgesG = svg.querySelector('#dep-graph-edges');
      if (!edgesG) {
        edgesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        edgesG.id = 'dep-graph-edges';
        svg.insertBefore(edgesG, svg.firstChild);
      }
      edgesG.innerHTML = '';

      const center = svg.querySelector('.dep-graph-node--center');
      if (!center) return;

      svg.querySelectorAll('.dep-graph-fo').forEach(function(fo) {
        if (!fo.querySelector('.dep-graph-expand')) return;
        const caller = fo.querySelector('.dep-graph-node--caller');
        if (caller) addGraphEdge(edgesG, svg, caller, 'right', center, 'left', 'dep-graph-edge--in');
      });

      svg.querySelectorAll('.dep-graph-node--dep, .dep-graph-node--external').forEach(function(dep) {
        addGraphEdge(edgesG, svg, center, 'right', dep, 'left', 'dep-graph-edge--out');
      });

      svg.querySelectorAll('g[data-expansion-for]').forEach(function(expG) {
        const parentPath = expG.getAttribute('data-expansion-for');
        const parentChip = findMainCallerChip(svg, parentPath);
        if (!parentChip) return;
        expG.querySelectorAll('.dep-graph-node--caller').forEach(function(expCaller) {
          addGraphEdge(edgesG, svg, expCaller, 'right', parentChip, 'left', 'dep-graph-edge--in');
        });
      });
    }

    function positionExpansionColumns(svg) {
      svg.querySelectorAll('g[data-expansion-for]').forEach(function(expG) {
        const parentPath = expG.getAttribute('data-expansion-for');
        const parentChip = findMainCallerChip(svg, parentPath);
        if (!parentChip) return;
        const parentLeft = chipAnchor(svg, parentChip, 'left');
        const expFos = Array.from(expG.querySelectorAll('foreignObject'));
        expFos.forEach(fitForeignObject);
        const gap = 6;
        const totalH = expFos.reduce(function(sum, fo, i) {
          return sum + parseFloat(fo.getAttribute('height') || '0') + (i > 0 ? gap : 0);
        }, 0);
        let curY = parentLeft.y - totalH / 2;
        expFos.forEach(function(fo) {
          const w = parseFloat(fo.getAttribute('width') || '0');
          const h = parseFloat(fo.getAttribute('height') || '0');
          fo.setAttribute('x', String(parentLeft.x - DEP_GRAPH.EXPAND_COL_GAP - w));
          fo.setAttribute('y', String(curY));
          curY += h + gap;
        });
      });
    }

    function adjustGraphViewBox(svg) {
      const svgW = parseFloat(svg.getAttribute('width') || '${GRAPH_WIDTH}');
      const svgH = parseFloat(svg.getAttribute('height') || '120');
      let minX = 0;
      svg.querySelectorAll('foreignObject').forEach(function(fo) {
        const x = parseFloat(fo.getAttribute('x') || '0');
        if (x < minX) minX = x;
      });
      const padding = 8;
      const vbMinX = minX < 0 ? minX - padding : 0;
      const vbW = svgW - vbMinX;
      svg.setAttribute('viewBox', vbMinX + ' 0 ' + vbW + ' ' + svgH);
    }

    function relayoutDependencyGraph() {
      const svg = depGraphSvg;
      if (!svg) return;

      const rowIndices = [];
      svg.querySelectorAll('foreignObject[data-graph-row]').forEach(function(fo) {
        const row = fo.getAttribute('data-graph-row');
        if (row !== null && rowIndices.indexOf(row) === -1) rowIndices.push(row);
      });
      rowIndices.sort(function(a, b) { return Number(a) - Number(b); });

      let y = DEP_GRAPH.PAD_TOP;
      rowIndices.forEach(function(rowKey) {
        const fos = Array.from(svg.querySelectorAll('foreignObject[data-graph-row="' + rowKey + '"]'));
        let maxH = 0;
        fos.forEach(function(fo) {
          fitForeignObject(fo);
          maxH = Math.max(maxH, parseFloat(fo.getAttribute('height') || '0'));
        });
        const rowCenterY = y + maxH / 2;
        fos.forEach(function(fo) {
          const foH = parseFloat(fo.getAttribute('height') || '0');
          fo.setAttribute('y', String(y + (maxH - foH) / 2));
          const expandBtn = fo.querySelector('.dep-graph-expand');
          if (expandBtn) expandBtn.setAttribute('data-node-y', String(rowCenterY));
        });
        y += maxH + DEP_GRAPH.ROW_GAP;
      });

      const centerFo = svg.querySelector('foreignObject[data-graph-col="center"]');
      const svgH = Math.max(y + 20, 120);
      svg.setAttribute('height', String(svgH));
      if (centerFo) {
        fitForeignObject(centerFo);
        const centerH = parseFloat(centerFo.getAttribute('height') || '32');
        centerFo.setAttribute('y', String((svgH - centerH) / 2));
      }

      positionExpansionColumns(svg);
      adjustGraphViewBox(svg);
      drawDependencyEdges(svg);
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.action === 'expandNode') {
        e.preventDefault();
        const filePath = target.dataset.file;
        const depGraph = document.getElementById('dep-graph');
        const symbolName = depGraph ? depGraph.dataset.symbolName : '';
        if (!filePath || !symbolName) return;
        const sourceFile = depGraph ? depGraph.dataset.sourceFile : '';
        const excludePaths = [filePath];
        if (sourceFile) excludePaths.push(sourceFile);
        document.querySelectorAll('.dep-graph-node--caller[data-file]').forEach((el) => {
          const p = el.dataset.file;
          if (p) excludePaths.push(p);
        });
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

    const depGraphSvg = document.getElementById('dep-graph-svg');

    function shortPathClient(p) {
      const parts = String(p).replace(/\\\\/g, '/').split('/');
      return parts.slice(-2).join('/');
    }

    function handleNodeExpanded(payload) {
      const parentFilePath = payload ? payload.parentFilePath : '';
      const expandBtn = document.querySelector('.dep-graph-expand[data-file="' + parentFilePath.replace(/"/g, '\\\\"') + '"]');
      if (!payload || !payload.callers || payload.callers.length === 0) {
        if (expandBtn) {
          expandBtn.disabled = false;
          expandBtn.textContent = '+';
          expandBtn.title = 'No further callers';
        }
        return;
      }
      appendExpansionColumn(payload);
    }

    function appendExpansionColumn(payload) {
      if (!depGraphSvg || !payload || !payload.callers || payload.callers.length === 0) return;
      const parentFilePath = payload.parentFilePath;
      const expandBtn = document.querySelector('.dep-graph-expand[data-file="' + parentFilePath.replace(/"/g, '\\\\"') + '"]');
      if (expandBtn) {
        expandBtn.textContent = '\\u2713';
        expandBtn.title = 'Expanded';
      }
      if (depGraphSvg.querySelector('[data-expansion-for="' + parentFilePath.replace(/"/g, '\\\\"') + '"]')) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-expansion-for', parentFilePath);

      payload.callers.forEach(function(caller) {
        const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('data-graph-col', 'expand');
        fo.setAttribute('x', '0');
        fo.setAttribute('y', '0');
        fo.setAttribute('width', String(DEP_GRAPH.EXPAND_COL_W));
        fo.setAttribute('height', '20');
        const label = esc(shortPathClient(caller.filePath));
        fo.innerHTML = '<div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo"><button type="button" class="dep-graph-node dep-graph-node--caller" data-file="' + esc(caller.filePath) + '">' + label + '</button></div>';
        g.appendChild(fo);
      });

      depGraphSvg.appendChild(g);
      relayoutDependencyGraph();
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
        handleNodeExpanded(msg.payload);
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

    if (depGraphSvg) {
      requestAnimationFrame(function() { relayoutDependencyGraph(); });
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
  sourceFilePath: string,
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
  const dependencyGraph = renderDependencyGraph(dependsOn, usedBy, symbolName, sourceFilePath);

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
const GRAPH_WIDTH = 616;
const GRAPH_ROW_HEIGHT = 50;
const GRAPH_PAD_TOP = 36;

const DEP_GRAPH_LEFT_COL_X = 8;
const DEP_GRAPH_LEFT_COL_W = 168;
const DEP_GRAPH_COL_GAP = 48;
const DEP_GRAPH_CENTER_COL_W = 160;
const DEP_GRAPH_CENTER_COL_X = DEP_GRAPH_LEFT_COL_X + DEP_GRAPH_LEFT_COL_W + DEP_GRAPH_COL_GAP;
const DEP_GRAPH_RIGHT_COL_W = 168;
const DEP_GRAPH_RIGHT_COL_X = DEP_GRAPH_CENTER_COL_X + DEP_GRAPH_CENTER_COL_W + DEP_GRAPH_COL_GAP;
const DEP_GRAPH_EXPAND_COL_W = 150;
const DEP_GRAPH_EXPAND_COL_GAP = 48;

interface GroupedGraphNode {
  filePath: string;
  name: string;
  kind: DependencyRef['kind'];
  count: number;
  names: string[];
}

function groupDepsByFile(refs: DependencyRef[]): GroupedGraphNode[] {
  const map = new Map<string, GroupedGraphNode>();
  for (const ref of refs) {
    const existing = map.get(ref.filePath);
    if (existing) {
      existing.count += 1;
      if (!existing.names.includes(ref.name)) {
        existing.names.push(ref.name);
      }
    } else {
      map.set(ref.filePath, {
        filePath: ref.filePath,
        name: ref.name,
        kind: ref.kind,
        count: 1,
        names: [ref.name],
      });
    }
  }
  return [...map.values()];
}

function renderGraphCountBadge(count: number): string {
  if (count <= 1) return '';
  return `<span class="dep-graph-count">${count}</span>`;
}

function graphNodeTooltip(node: GroupedGraphNode): string {
  if (node.count <= 1) return '';
  return ` title="${escAttr(`Imported as: ${node.names.join(', ')}`)}"`;
}

function renderDependencyGraph(
  dependsOn: DependencyRef[],
  usedBy: DependencyRef[],
  symbolName: string,
  sourceFilePath: string,
): string {
  if (dependsOn.length === 0 && usedBy.length === 0) {
    return '';
  }

  const groupedUsedBy = groupDepsByFile(usedBy);
  const groupedDependsOn = groupDepsByFile(dependsOn);
  const leftNodes = groupedUsedBy.slice(0, MAX_GRAPH_NODES);
  const rightNodes = groupedDependsOn.slice(0, MAX_GRAPH_NODES);
  const leftOverflow = groupedUsedBy.length - leftNodes.length;
  const rightOverflow = groupedDependsOn.length - rightNodes.length;

  const maxRows = Math.max(leftNodes.length, rightNodes.length, 1);
  const height = Math.max(GRAPH_PAD_TOP + maxRows * GRAPH_ROW_HEIGHT + 20, 120);
  const centerLabel = escHtml(symbolName);

  const parts: string[] = [
    '<g id="dep-graph-edges"></g>',
  ];

  parts.push(`<foreignObject x="${DEP_GRAPH_CENTER_COL_X}" y="0" width="${DEP_GRAPH_CENTER_COL_W}" height="32" data-graph-col="center">
      <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo dep-graph-fo--center">
        <span class="dep-graph-node dep-graph-node--center">${centerLabel}</span>
      </div>
    </foreignObject>`);

  leftNodes.forEach((node, i) => {
    const y = GRAPH_PAD_TOP + i * GRAPH_ROW_HEIGHT;
    const label = escHtml(shortPath(node.filePath));
    parts.push(`<foreignObject x="${DEP_GRAPH_LEFT_COL_X}" y="${y}" width="${DEP_GRAPH_LEFT_COL_W}" height="28" data-graph-col="left" data-graph-row="${i}">
      <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo">
        <button type="button" class="dep-graph-expand" data-action="expandNode" data-file="${escAttr(node.filePath)}" title="Expand callers">+</button>
        <button type="button" class="dep-graph-node dep-graph-node--caller" data-file="${escAttr(node.filePath)}">${label}${renderGraphCountBadge(node.count)}</button>
      </div>
    </foreignObject>`);
  });

  rightNodes.forEach((node, i) => {
    const y = GRAPH_PAD_TOP + i * GRAPH_ROW_HEIGHT;
    const external = isExternalModule(node.filePath);
    const label = escHtml(external ? node.name : shortPath(node.filePath));
    const tooltip = graphNodeTooltip(node);
    if (external) {
      parts.push(`<foreignObject x="${DEP_GRAPH_RIGHT_COL_X}" y="${y}" width="${DEP_GRAPH_RIGHT_COL_W}" height="28" data-graph-col="right" data-graph-row="${i}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo">
          <span class="dep-graph-node dep-graph-node--external"${tooltip}>${label}${renderGraphCountBadge(node.count)}</span>
        </div>
      </foreignObject>`);
    } else {
      parts.push(`<foreignObject x="${DEP_GRAPH_RIGHT_COL_X}" y="${y}" width="${DEP_GRAPH_RIGHT_COL_W}" height="28" data-graph-col="right" data-graph-row="${i}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="dep-graph-fo">
          <button type="button" class="dep-graph-node dep-graph-node--dep" data-file="${escAttr(node.filePath)}"${tooltip}>${label}${renderGraphCountBadge(node.count)}</button>
        </div>
      </foreignObject>`);
    }
  });

  if (leftOverflow > 0) {
    const y = GRAPH_PAD_TOP + leftNodes.length * GRAPH_ROW_HEIGHT + 8;
    const leftOverflowX = DEP_GRAPH_LEFT_COL_X + DEP_GRAPH_LEFT_COL_W / 2;
    parts.push(`<text class="dep-graph-overflow" x="${leftOverflowX}" y="${y}" text-anchor="middle">+${leftOverflow} more</text>`);
  }
  if (rightOverflow > 0) {
    const y = GRAPH_PAD_TOP + rightNodes.length * GRAPH_ROW_HEIGHT + 8;
    const rightOverflowX = DEP_GRAPH_RIGHT_COL_X + DEP_GRAPH_RIGHT_COL_W / 2;
    parts.push(`<text class="dep-graph-overflow" x="${rightOverflowX}" y="${y}" text-anchor="middle">+${rightOverflow} more</text>`);
  }

  return `<div class="dep-subsection dep-subsection--flow">
  <div class="dep-subsection-label">Dependency Flow</div>
  <div class="dep-graph-wrap" id="dep-graph" data-symbol-name="${escAttr(symbolName)}" data-source-file="${escAttr(sourceFilePath)}">
    <svg class="dep-graph-svg" id="dep-graph-svg" width="${GRAPH_WIDTH}" height="${height}" viewBox="0 0 ${GRAPH_WIDTH} ${height}" aria-label="Dependency flow diagram">
      ${parts.join('\n      ')}
    </svg>
  </div>
</div>`;
}

function renderCoChangeHeatmap(git: GitHistory): string {
  const items = git.coChangedWith ?? [];
  if (items.length === 0) return '';

  const rows = items.map((item, index) => {
    const countLabel = item.count === 1 ? '1 commit' : `${item.count} commits`;
    return `<button type="button" class="cochange-row" data-file="${escAttr(item.filePath)}">
  <span class="cochange-rank">#${index + 1}</span>
  <span class="cochange-label">${escHtml(item.relativePath)}</span>
  <span class="cochange-count">${escHtml(countLabel)}</span>
</button>`;
  }).join('');

  return `<div class="dep-subsection">
  <div class="dep-subsection-label">Change Coupling</div>
  <div class="cochange-list">${rows}</div>
</div>`;
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
