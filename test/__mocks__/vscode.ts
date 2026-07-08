/**
 * Minimal VS Code API stub for unit tests.
 * Only the surface that src/ actually imports is replicated here.
 */

export const workspace = {
  workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
};

export const window = {
  showInformationMessage: async (_msg: string) => undefined,
  showWarningMessage: async (_msg: string) => undefined,
  showErrorMessage: async (_msg: string) => undefined,
  createStatusBarItem: (_alignment?: number, _priority?: number) => ({
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  }),
};

export const commands = {
  registerCommand: (_id: string, _cb: () => void) => ({ dispose: () => undefined }),
  executeCommand: async <T>(_cmd: string, ..._args: unknown[]): Promise<T | undefined> =>
    undefined,
};

export const ProgressLocation = { Notification: 15, Window: 10 };
export const StatusBarAlignment = { Left: 1, Right: 2 };

export class Uri {
  static file(p: string): { fsPath: string } {
    return { fsPath: p };
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Selection extends Position {}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position,
  ) {}
}

export enum TextEditorRevealType {
  InCenter = 1,
}
