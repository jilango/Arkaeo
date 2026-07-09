import type { SymbolAnalysis, DependencyRef } from '../models/analysis';

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

export interface NodeExpandedMessage {
  type: 'nodeExpanded';
  payload: {
    parentFilePath: string;
    callers: DependencyRef[];
  };
}

export type ExtensionToWebviewMessage =
  | AnalysisMessage
  | AiResultMessage
  | AiErrorMessage
  | NodeExpandedMessage;

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

export interface ExpandNodeMessage {
  type: 'expandNode';
  filePath: string;
  symbolName: string;
  excludePaths?: string[];
}

export type WebviewToExtensionMessage =
  | ExplainWithAiMessage
  | OpenFileMessage
  | ExpandNodeMessage;
