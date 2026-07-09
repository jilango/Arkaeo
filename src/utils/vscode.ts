import * as vscode from 'vscode';
import * as path from 'path';
import type { DependencyRef } from '../models/analysis';

/**
 * Returns the absolute path to the first workspace folder, or undefined if no
 * workspace is open.
 */
export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Makes a file path relative to the workspace root for display purposes.
 * Falls back to the basename if no workspace is open.
 */
export function toRelativePath(absolutePath: string): string {
  const root = getWorkspaceRoot();
  if (root) {
    return path.relative(root, absolutePath);
  }
  return path.basename(absolutePath);
}

/**
 * Opens a file in the editor at an optional line number (0-based).
 */
export async function openFileAtLine(filePath: string, line?: number): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);

  if (line !== undefined) {
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

const MAX_EXPAND_CALLERS = 8;

/**
 * Finds files that reference `symbolName` from a caller file (one hierarchy level up).
 */
export async function findExpandedCallers(
  filePath: string,
  symbolName: string,
  excludePaths: string[] = [],
): Promise<DependencyRef[]> {
  const exclude = new Set(excludePaths);

  let line = 0;
  let col = 0;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const text = doc.getText();
    const idx = text.indexOf(symbolName);
    if (idx < 0) return [];
    const position = doc.positionAt(idx);
    line = position.line;
    col = position.character;
  } catch {
    return [];
  }

  try {
    const uri = vscode.Uri.file(filePath);
    const pos = new vscode.Position(line, col);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      pos,
    );
    if (!locations?.length) return [];

    const refs: DependencyRef[] = [];
    const seen = new Set<string>();
    for (const loc of locations) {
      const refPath = loc.uri.fsPath;
      if (refPath === filePath) continue;
      if (exclude.has(refPath)) continue;
      if (seen.has(refPath)) continue;
      seen.add(refPath);
      refs.push({ name: symbolName, filePath: refPath, kind: 'reference' });
      if (refs.length >= MAX_EXPAND_CALLERS) break;
    }
    return refs;
  } catch {
    return [];
  }
}
