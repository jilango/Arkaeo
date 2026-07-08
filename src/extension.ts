import * as vscode from 'vscode';
import { getAstAnalyzer, disposeAstAnalyzer } from './analysis/astAnalyzer';
import { AnalysisService } from './analysis/analysisService';
import { analyzeSymbolCommand } from './commands/analyzeSymbol';
import { PanelManager } from './ui/panel';
import { getWorkspaceRoot } from './utils/vscode';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot() ?? context.extensionUri.fsPath;
  const astAnalyzer = getAstAnalyzer(workspaceRoot);
  const analysisService = new AnalysisService(astAnalyzer, workspaceRoot);
  const panelManager = new PanelManager(context.extensionUri);

  // Status bar item — shown after the first successful analysis
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'arkaeo.analyzeSymbol';

  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'typescript' || doc.languageId === 'typescriptreact') {
      astAnalyzer.refreshFile(doc.uri.fsPath);
    }
  });

  const analyzeCommand = vscode.commands.registerCommand(
    'arkaeo.analyzeSymbol',
    () => analyzeSymbolCommand(analysisService, panelManager, statusBar),
  );

  context.subscriptions.push(analyzeCommand, onSave, panelManager, statusBar);
}

export function deactivate(): void {
  disposeAstAnalyzer();
}
