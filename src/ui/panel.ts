import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { SymbolAnalysis } from '../models/analysis';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from './messages';
import { renderTemplate } from './template';
import { openFileAtLine } from '../utils/vscode';
import { getApiKey } from '../commands/manageApiKey';

/**
 * Manages the single Arkaeo Webview panel.
 *
 * Only one panel exists at a time. Calling show() on an already-open panel
 * updates its content rather than creating a new tab.
 */
export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly secrets: vscode.SecretStorage;
  private onExplainAi: (() => Promise<string>) | undefined;

  constructor(extensionUri: vscode.Uri, secrets: vscode.SecretStorage) {
    this.extensionUri = extensionUri;
    this.secrets = secrets;
  }

  /**
   * Opens or reveals the panel and renders the given analysis.
   * @param analysis    - Full SymbolAnalysis to display.
   * @param onExplainAi - Called when the user clicks "Explain with AI".
   *                      Should return the AI explanation text.
   */
  show(analysis: SymbolAnalysis, onExplainAi?: () => Promise<string>): void {
    this.onExplainAi = onExplainAi;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      void this.updateContent(analysis);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'arkaeo',
      'Arkaeo',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'src', 'ui'),
          vscode.Uri.joinPath(this.extensionUri, 'dist'),
        ],
        retainContextWhenHidden: true,
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as WebviewToExtensionMessage);
    });

    void this.updateContent(analysis);
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

  private async updateContent(analysis: SymbolAnalysis): Promise<void> {
    if (!this.panel) return;

    const nonce = this.generateNonce();
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'styles.css'),
    );
    const cspSource = this.panel.webview.cspSource;
    // Read key from the secure store — never from settings.json
    const hasApiKey = await this.apiKeyConfigured();

    this.panel.title = `Arkaeo — ${analysis.symbol.name}`;
    this.panel.webview.html = renderTemplate(
      analysis,
      styleUri.toString(),
      cspSource,
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

  private async apiKeyConfigured(): Promise<boolean> {
    const key = await getApiKey(this.secrets);
    return typeof key === 'string' && key.trim().length > 0;
  }
}
