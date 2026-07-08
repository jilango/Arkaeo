import * as vscode from 'vscode';
import type { AnalysisService } from '../analysis/analysisService';
import type { PanelManager } from '../ui/panel';
import type { AiProvider } from '../ai/aiProvider';
import { AiError } from '../ai/aiProvider';
import { buildPrompt, promptWithinBudget } from '../ai/prompts';
import type { SymbolAnalysis } from '../models/analysis';

/** Minimum milliseconds between AI requests (simple per-session rate limit). */
const AI_COOLDOWN_MS = 10_000;
let lastAiRequestAt = 0;

/**
 * Entry point for the "Arkaeo: Analyze Symbol" command.
 *
 * Progress is shown in the status bar and is cancellable — pressing cancel
 * aborts any in-flight git processes immediately.
 */
export async function analyzeSymbolCommand(
  analysisService: AnalysisService,
  panelManager: PanelManager,
  statusBar: vscode.StatusBarItem,
  aiProvider?: AiProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Arkaeo: Open a TypeScript file to analyze a symbol.');
    return;
  }

  const { document, selection } = editor;
  const languageId = document.languageId;

  if (languageId !== 'typescript' && languageId !== 'typescriptreact') {
    void vscode.window.showWarningMessage(
      'Arkaeo: Symbol analysis currently supports TypeScript files only.',
    );
    return;
  }

  const abortController = new AbortController();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'Arkaeo',
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => abortController.abort());
      _progress.report({ message: 'Analyzing symbol…' });

      const position = selection.active;
      const result = await analysisService.analyzeSymbol(
        document.uri.fsPath,
        position.line,
        position.character,
        abortController.signal,
      );

      if (token.isCancellationRequested) return;

      if (!result) {
        void vscode.window.showWarningMessage(
          'Arkaeo: No symbol found at cursor. Place your cursor inside a function, method, or class.',
        );
        return;
      }

      // Build the AI callback only when a provider is available
      const onExplainAi = aiProvider
        ? () => explainWithAi(aiProvider, result)
        : undefined;

      panelManager.show(result, onExplainAi);

      const label = result.symbol.containingClass
        ? `${result.symbol.containingClass}.${result.symbol.name}`
        : result.symbol.name;
      statusBar.text = `$(info) Arkaeo: ${label}`;
      statusBar.tooltip = `Risk: ${result.risk.level} · ${result.git.commitCount} commits · Click to re-analyze`;
      statusBar.show();
    },
  );
}

// ---------------------------------------------------------------------------
// AI explanation
// ---------------------------------------------------------------------------

async function explainWithAi(provider: AiProvider, analysis: SymbolAnalysis): Promise<string> {
  // Per-session rate limit
  const now = Date.now();
  if (now - lastAiRequestAt < AI_COOLDOWN_MS) {
    const remaining = Math.ceil((AI_COOLDOWN_MS - (now - lastAiRequestAt)) / 1000);
    throw new Error(`Please wait ${remaining}s before requesting another explanation.`);
  }

  const prompt = buildPrompt(analysis);

  if (!promptWithinBudget(prompt)) {
    throw new Error(
      'The analysis is too large to send to the AI. Try analyzing a smaller symbol.',
    );
  }

  lastAiRequestAt = Date.now();

  // Use the two-argument variant to keep system and user prompts separate
  if ('explainWithSystem' in provider && typeof provider.explainWithSystem === 'function') {
    return (provider as { explainWithSystem: (s: string, u: string) => Promise<string> })
      .explainWithSystem(prompt.system, prompt.user);
  }

  // Fallback: combine into one message
  return provider.explain(`${prompt.system}\n\n${prompt.user}`);
}
