import * as vscode from 'vscode';
import { getAstAnalyzer, disposeAstAnalyzer } from './analysis/astAnalyzer';
import { AnalysisService } from './analysis/analysisService';
import { analyzeSymbolCommand } from './commands/analyzeSymbol';
import { PanelManager } from './ui/panel';
import { getWorkspaceRoot } from './utils/vscode';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot();
  const astAnalyzer = getAstAnalyzer(workspaceRoot);
  const analysisService = new AnalysisService(astAnalyzer);
  const panelManager = new PanelManager(context.extensionUri);

  // Refresh ts-morph cache when a file is saved so analysis reflects latest changes.
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'typescript' || doc.languageId === 'typescriptreact') {
      astAnalyzer.refreshFile(doc.uri.fsPath);
    }
  });

  const analyzeCommand = vscode.commands.registerCommand(
    'arkaeo.analyzeSymbol',
    () => analyzeSymbolCommand(analysisService, panelManager),
  );

  context.subscriptions.push(analyzeCommand, onSave, panelManager);
}

export function deactivate(): void {
  disposeAstAnalyzer();
}
