import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { SymbolAnalysis } from '../models/analysis';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from './messages';
import { renderTemplate } from './template';
import { openFileAtLine } from '../utils/vscode';

/**
 * Manages the single Arkaeo Webview panel.
 *
 * Only one panel exists at a time. Calling show() on an already-open panel
 * updates its content rather than creating a new tab.
 */
export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;
  private onExplainAi: (() => Promise<string>) | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Opens or reveals the panel and renders the given analysis.
   * @param analysis   - Full SymbolAnalysis to display.
   * @param onExplainAi - Called when the user clicks "Explain with AI".
   *                      Receives no args; should return the AI explanation text.
   */
  show(analysis: SymbolAnalysis, onExplainAi?: () => Promise<string>): void {
    this.onExplainAi = onExplainAi;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.updateContent(analysis);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'arkaeo',
      'Arkaeo',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui')],
        retainContextWhenHidden: true,
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as WebviewToExtensionMessage);
    });

    this.updateContent(analysis);
  }

  /** Sends an AI result back to the Webview. */
  postMessage(msg: ExtensionToWebviewMessage): void {
    void this.panel?.webview.postMessage(msg);
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private updateContent(analysis: SymbolAnalysis): void {
    if (!this.panel) return;

    const nonce = this.generateNonce();
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'styles.css'),
    );
    const hasApiKey = this.apiKeyConfigured();

    this.panel.title = `Arkaeo — ${analysis.symbol.name}`;
    this.panel.webview.html = renderTemplate(
      analysis,
      styleUri.toString(),
      nonce,
      hasApiKey,
    );
  }

  private async handleMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.type) {
      case 'openFile':
        await openFileAtLine(msg.filePath, msg.line);
        break;

      case 'explainWithAI':
        if (!this.onExplainAi) {
          this.postMessage({ type: 'aiError', payload: 'AI provider not configured.' });
          return;
        }
        try {
          const result = await this.onExplainAi();
          this.postMessage({ type: 'aiResult', payload: result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.postMessage({ type: 'aiError', payload: message });
        }
        break;
    }
  }

  private generateNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private apiKeyConfigured(): boolean {
    const key = vscode.workspace.getConfiguration('arkaeo').get<string>('openaiApiKey');
    return typeof key === 'string' && key.trim().length > 0;
  }
}
