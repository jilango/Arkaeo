import * as vscode from 'vscode';
import type { AnalysisService } from '../analysis/analysisService';
import type { PanelManager } from '../ui/panel';

/**
 * Entry point for the "Arkaeo: Analyze Symbol" command.
 *
 * Reads the active editor selection, delegates to AnalysisService, and opens
 * (or updates) the Arkaeo Webview panel with the results.
 */
export async function analyzeSymbolCommand(
  analysisService: AnalysisService,
  panelManager: PanelManager,
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Arkaeo: Analyzing symbol…',
      cancellable: false,
    },
    async () => {
      const position = selection.active;
      const result = await analysisService.analyzeSymbol(
        document.uri.fsPath,
        position.line,
        position.character,
      );

      if (!result) {
        void vscode.window.showWarningMessage(
          'Arkaeo: No symbol found at cursor. Place your cursor inside a function, method, or class.',
        );
        return;
      }

      panelManager.show(result);
    },
  );
}
