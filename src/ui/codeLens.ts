import * as vscode from 'vscode';
import type { AstAnalyzer } from '../analysis/astAnalyzer';

const CONFIG_SECTION = 'arkaeo';
const CONFIG_SHOW_CODE_LENS = 'showCodeLens';

export function isCodeLensEnabled(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(CONFIG_SHOW_CODE_LENS, true);
}

export class ArkaeoCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(private readonly ast: AstAnalyzer) {}

  bindRefreshHandlers(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.onDidChangeCodeLensesEmitter.fire();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.onDidChangeCodeLensesEmitter.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_SHOW_CODE_LENS}`)) {
          this.onDidChangeCodeLensesEmitter.fire();
        }
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isCodeLensEnabled()) return [];

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return [];

    if (document.languageId !== 'typescript' && document.languageId !== 'typescriptreact') {
      return [];
    }

    const { line, character } = editor.selection.active;
    const symbol = this.ast.detectSymbolAtPosition(document.uri.fsPath, line, character);
    if (!symbol) return [];

    const lensLine = symbol.location.startLine - 1;
    const range = new vscode.Range(lensLine, 0, lensLine, 0);
    const analyzeLine = symbol.location.startLine - 1;
    const analyzeCharacter = symbol.location.nameColumn;

    return [
      new vscode.CodeLens(range, {
        title: 'Analyze with Arkaeo',
        command: 'arkaeo.analyzeSymbolAt',
        arguments: [document.uri.toString(), analyzeLine, analyzeCharacter],
      }),
    ];
  }
}

export function registerCodeLensProvider(
  ast: AstAnalyzer,
  context: vscode.ExtensionContext,
): ArkaeoCodeLensProvider {
  const provider = new ArkaeoCodeLensProvider(ast);
  provider.bindRefreshHandlers(context);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: 'typescript' }, { language: 'typescriptreact' }],
      provider,
    ),
  );
  return provider;
}
