import * as vscode from 'vscode';
import { getAstAnalyzer, disposeAstAnalyzer } from './analysis/astAnalyzer';
import { AnalysisService } from './analysis/analysisService';
import { analyzeSymbolCommand } from './commands/analyzeSymbol';
import { setApiKeyCommand, clearApiKeyCommand, getApiKey } from './commands/manageApiKey';
import { PanelManager } from './ui/panel';
import { AnthropicProvider } from './ai/anthropicProvider';
import { getWorkspaceRoot } from './utils/vscode';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot() ?? context.extensionUri.fsPath;
  const astAnalyzer = getAstAnalyzer(workspaceRoot);
  const analysisService = new AnalysisService(astAnalyzer, workspaceRoot);
  const panelManager = new PanelManager(context.extensionUri, context.secrets);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'arkaeo.analyzeSymbol';

  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'typescript' || doc.languageId === 'typescriptreact') {
      astAnalyzer.refreshFile(doc.uri.fsPath);
    }
  });

  // Re-usable helper — reads the key fresh from secrets each invocation
  async function getProvider(): Promise<AnthropicProvider | undefined> {
    const key = await getApiKey(context.secrets);
    return key ? new AnthropicProvider(key) : undefined;
  }

  const analyzeCommand = vscode.commands.registerCommand(
    'arkaeo.analyzeSymbol',
    async () => analyzeSymbolCommand(analysisService, panelManager, statusBar, await getProvider()),
  );

  const setKeyCommand = vscode.commands.registerCommand(
    'arkaeo.setApiKey',
    () => setApiKeyCommand(context.secrets),
  );

  const clearKeyCommand = vscode.commands.registerCommand(
    'arkaeo.clearApiKey',
    () => clearApiKeyCommand(context.secrets),
  );

  context.subscriptions.push(analyzeCommand, setKeyCommand, clearKeyCommand, onSave, panelManager, statusBar);
}

export function deactivate(): void {
  disposeAstAnalyzer();
}
