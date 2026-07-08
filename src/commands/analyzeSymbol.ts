import * as vscode from 'vscode';
import type { AnalysisService } from '../analysis/analysisService';
import type { PanelManager } from '../ui/panel';

/**
 * Entry point for the "Arkaeo: Analyze Symbol" command.
 *
 * Progress is shown in the status bar area and is cancellable — pressing the
 * cancel button aborts any in-flight git processes immediately.
 */
export async function analyzeSymbolCommand(
  analysisService: AnalysisService,
  panelManager: PanelManager,
  statusBar: vscode.StatusBarItem,
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
      // Bridge the VS Code cancellation token to the Web AbortController
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

      panelManager.show(result);

      // Update status bar to show what was last analyzed
      const label = result.symbol.containingClass
        ? `${result.symbol.containingClass}.${result.symbol.name}`
        : result.symbol.name;
      statusBar.text = `$(info) Arkaeo: ${label}`;
      statusBar.tooltip = `Risk: ${result.risk.level} · ${result.git.commitCount} commits · Click to re-analyze`;
      statusBar.show();
    },
  );
}
