import * as path from 'path';
import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  FunctionDeclaration,
  MethodDeclaration,
  ClassDeclaration,
  ArrowFunction,
  VariableDeclaration,
  FunctionExpression,
} from 'ts-morph';
import type { DetectedSymbol, SymbolKind } from '../models/symbol';
import type { StaticAnalysis } from '../models/analysis';
import { toRelativePath } from '../utils/vscode';

export class AstAnalyzer {
  private project: Project;

  constructor(tsConfigFilePath?: string) {
    this.project = new Project({
      tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Finds the innermost named symbol that contains the given cursor position.
   * Returns null if no meaningful symbol can be identified.
   */
  detectSymbolAtPosition(
    filePath: string,
    line: number,
    character: number,
  ): DetectedSymbol | null {
    const sourceFile = this.getOrAddSourceFile(filePath);
    if (!sourceFile) return null;

    const offset = sourceFile.compilerNode.getPositionOfLineAndCharacter(line, character);
    const node = sourceFile.getDescendantAtPos(offset);
    if (!node) return null;

    return this.walkToNamedSymbol(node, filePath);
  }

  /**
   * Extracts static facts (imports, exports, methods) from the file containing
   * the detected symbol.
   */
  analyzeStatic(symbol: DetectedSymbol): StaticAnalysis {
    const sourceFile = this.getOrAddSourceFile(symbol.location.filePath);
    if (!sourceFile) {
      return { imports: [], exports: [] };
    }

    const imports = sourceFile
      .getImportDeclarations()
      .map((imp) => imp.getModuleSpecifierValue());

    const exports = sourceFile
      .getExportDeclarations()
      .flatMap((exp) =>
        exp.getNamedExports().map((ne) => ne.getName()),
      );

    // Also capture inline exports (export function / export class)
    const inlineExports = sourceFile
      .getExportedDeclarations()
      .keys();
    for (const name of inlineExports) {
      if (!exports.includes(name)) {
        exports.push(name);
      }
    }

    const result: StaticAnalysis = { imports, exports };

    if (symbol.kind === 'class') {
      const classNode = sourceFile.getClass(symbol.name);
      if (classNode) {
        result.methods = classNode.getMethods().map((m) => m.getName());
      }
    }

    return result;
  }

  /** Invalidates and re-adds a source file (call on save). */
  refreshFile(filePath: string): void {
    const existing = this.project.getSourceFile(filePath);
    if (existing) {
      existing.refreshFromFileSystemSync();
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrAddSourceFile(filePath: string): SourceFile | undefined {
    const existing = this.project.getSourceFile(filePath);
    if (existing) return existing;

    try {
      return this.project.addSourceFileAtPath(filePath);
    } catch {
      return undefined;
    }
  }

  /**
   * Walks up the AST from `node` to find the nearest enclosing named symbol.
   * Order of precedence: MethodDeclaration > FunctionDeclaration >
   * FunctionExpression > ArrowFunction (named via variable) > ClassDeclaration.
   */
  private walkToNamedSymbol(node: Node, filePath: string): DetectedSymbol | null {
    let current: Node | undefined = node;

    while (current) {
      const result = this.tryExtractSymbol(current, filePath);
      if (result) return result;
      current = current.getParent();
    }

    return null;
  }

  private tryExtractSymbol(node: Node, filePath: string): DetectedSymbol | null {
    if (Node.isMethodDeclaration(node)) {
      return this.fromMethod(node, filePath);
    }

    if (Node.isFunctionDeclaration(node) && node.getName()) {
      return this.fromFunction(node, filePath);
    }

    if (Node.isFunctionExpression(node)) {
      return this.fromFunctionExpression(node, filePath);
    }

    if (Node.isArrowFunction(node)) {
      return this.fromArrowFunction(node, filePath);
    }

    if (Node.isClassDeclaration(node) && node.getName()) {
      return this.fromClass(node, filePath);
    }

    // Handle `const foo = () => ...` or `const foo = function() {...}` when
    // the cursor lands on the variable name or the `const` keyword rather
    // than inside the function body.
    if (Node.isVariableDeclaration(node)) {
      const initializer = node.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) {
        return {
          name: node.getName(),
          kind: 'function',
          location: this.buildLocation(initializer, filePath),
          signature: this.buildSignature(initializer),
        };
      }
    }

    return null;
  }

  private fromMethod(node: MethodDeclaration, filePath: string): DetectedSymbol {
    const parent = node.getParent();
    const containingClass =
      Node.isClassDeclaration(parent) ? (parent.getName() ?? undefined) : undefined;

    return {
      name: node.getName(),
      kind: 'method',
      location: this.buildLocation(node, filePath),
      containingClass,
      signature: this.buildSignature(node),
    };
  }

  private fromFunction(node: FunctionDeclaration, filePath: string): DetectedSymbol {
    return {
      name: node.getName() ?? '(anonymous)',
      kind: 'function',
      location: this.buildLocation(node, filePath),
      signature: this.buildSignature(node),
    };
  }

  private fromFunctionExpression(node: FunctionExpression, filePath: string): DetectedSymbol | null {
    const name = node.getName();
    if (!name) {
      // Try variable declaration parent
      const varDecl = node.getParentIfKind(SyntaxKind.VariableDeclaration) as
        | VariableDeclaration
        | undefined;
      if (!varDecl) return null;
      return {
        name: varDecl.getName(),
        kind: 'function',
        location: this.buildLocation(node, filePath),
        signature: this.buildSignature(node),
      };
    }
    return {
      name,
      kind: 'function',
      location: this.buildLocation(node, filePath),
      signature: this.buildSignature(node),
    };
  }

  private fromArrowFunction(node: ArrowFunction, filePath: string): DetectedSymbol | null {
    const varDecl = node.getParentIfKind(SyntaxKind.VariableDeclaration) as
      | VariableDeclaration
      | undefined;
    if (!varDecl) return null;

    return {
      name: varDecl.getName(),
      kind: 'function',
      location: this.buildLocation(node, filePath),
      signature: this.buildSignature(node),
    };
  }

  private fromClass(node: ClassDeclaration, filePath: string): DetectedSymbol {
    return {
      name: node.getName() ?? '(anonymous)',
      kind: 'class',
      location: this.buildLocation(node, filePath),
    };
  }

  private buildLocation(
    node: Node,
    filePath: string,
  ): DetectedSymbol['location'] {
    const start = node.getStartLineNumber(false);
    const end = node.getEndLineNumber();
    return {
      filePath,
      relativePath: toRelativePath(filePath),
      startLine: start,
      endLine: end,
    };
  }

  /**
   * Builds a human-readable signature string for functions and methods.
   * Works for FunctionDeclaration, FunctionExpression, MethodDeclaration, and ArrowFunction.
   */
  private buildSignature(
    node:
      | FunctionDeclaration
      | FunctionExpression
      | MethodDeclaration
      | ArrowFunction,
  ): string {
    const params = node
      .getParameters()
      .map((p) => p.getText())
      .join(', ');

    const returnType = node.getReturnTypeNode()?.getText() ?? '';
    return returnType ? `(${params}): ${returnType}` : `(${params})`;
  }
}

/** Singleton kept alive for the extension session, refreshed on save. */
let _analyzer: AstAnalyzer | undefined;

export function getAstAnalyzer(workspaceRoot?: string): AstAnalyzer {
  if (!_analyzer) {
    const tsConfigPath = workspaceRoot
      ? path.join(workspaceRoot, 'tsconfig.json')
      : undefined;
    _analyzer = new AstAnalyzer(tsConfigPath);
  }
  return _analyzer;
}

export function disposeAstAnalyzer(): void {
  _analyzer = undefined;
}
