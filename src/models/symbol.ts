export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'variable';

export interface SymbolLocation {
  /** Absolute path on disk */
  filePath: string;
  /** Path relative to workspace root */
  relativePath: string;
  startLine: number;
  endLine: number;
}

export interface DetectedSymbol {
  name: string;
  kind: SymbolKind;
  location: SymbolLocation;
  /** Only set when kind is 'method' */
  containingClass?: string;
  /** Human-readable signature, e.g. "(userId: string): Promise<User>" */
  signature?: string;
}
