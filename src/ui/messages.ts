import type { SymbolAnalysis } from '../models/analysis';

// ---------------------------------------------------------------------------
// Extension → Webview messages
// ---------------------------------------------------------------------------

export interface AnalysisMessage {
  type: 'analysis';
  payload: SymbolAnalysis;
}

export interface AiResultMessage {
  type: 'aiResult';
  payload: string;
}

export interface AiErrorMessage {
  type: 'aiError';
  payload: string;
}

export type ExtensionToWebviewMessage = AnalysisMessage | AiResultMessage | AiErrorMessage;

// ---------------------------------------------------------------------------
// Webview → Extension messages
// ---------------------------------------------------------------------------

export interface ExplainWithAiMessage {
  type: 'explainWithAI';
}

export interface OpenFileMessage {
  type: 'openFile';
  filePath: string;
  line?: number;
}

export type WebviewToExtensionMessage = ExplainWithAiMessage | OpenFileMessage;
