import * as vscode from 'vscode';
import * as path from 'path';

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
