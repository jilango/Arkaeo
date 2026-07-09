import * as vscode from 'vscode';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  Project,
  Node,
  SourceFile,
  SyntaxKind,
  Type,
  ClassDeclaration,
  MethodDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  ArrowFunction,
} from 'ts-morph';
import type { DetectedSymbol } from '../models/symbol';
import type { DependencyAnalysis, DependencyRef } from '../models/analysis';

const MAX_REFS = 50;

export class DependencyAnalyzer {
  constructor(private readonly project: Project) {}

  async analyze(symbol: DetectedSymbol): Promise<DependencyAnalysis> {
    const [dependsOn, usedBy] = await Promise.all([
      this.resolveDependsOn(symbol),
      this.resolveUsedBy(symbol),
    ]);
    return { dependsOn, usedBy };
  }

  // ---------------------------------------------------------------------------
  // Depends On — value imports and this.* member calls within the symbol body
  // ---------------------------------------------------------------------------

  private resolveDependsOn(symbol: DetectedSymbol): DependencyRef[] {
    const sourceFile = this.getOrAdd(symbol.location.filePath);
    if (!sourceFile) return [];

    const refs: DependencyRef[] = [];
    const seen = new Set<string>();

    const importMap = this.buildValueImportMap(sourceFile);
    const symbolNode = this.getSymbolNode(symbol, sourceFile);
    const body = symbolNode ? this.getSymbolBody(symbolNode) : undefined;
    if (!body) return refs;

    for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = id.getText();
      const mod = importMap.get(name);
      if (!mod) continue;

      const key = `${name}::${mod}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const resolvedPath = this.resolveModulePath(mod, symbol.location.filePath);
      refs.push({ name, filePath: resolvedPath, kind: 'import' });
    }

    if (symbolNode) {
      this.addThisPropertyDeps(symbolNode, sourceFile, body, refs, seen);
    }

    return refs;
  }

  private buildValueImportMap(sourceFile: SourceFile): Map<string, string> {
    const importMap = new Map<string, string>();
    for (const imp of sourceFile.getImportDeclarations()) {
      if (imp.isTypeOnly()) continue;

      const mod = imp.getModuleSpecifierValue();
      const defaultImport = imp.getDefaultImport();
      if (defaultImport) importMap.set(defaultImport.getText(), mod);
      for (const named of imp.getNamedImports()) {
        importMap.set(named.getAliasNode()?.getText() ?? named.getName(), mod);
      }
      const nsImport = imp.getNamespaceImport();
      if (nsImport) importMap.set(nsImport.getText(), mod);
    }
    return importMap;
  }

  private addThisPropertyDeps(
    symbolNode: Node,
    sourceFile: SourceFile,
    body: Node,
    refs: DependencyRef[],
    seen: Set<string>,
  ): void {
    const classDecl = this.getContainingClass(symbolNode, sourceFile);
    if (!classDecl) return;

    const propNames = new Set<string>();
    for (const pa of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (pa.getExpression().getKind() === SyntaxKind.ThisKeyword) {
        propNames.add(pa.getName());
      }
    }

    for (const propName of propNames) {
      const memberType = this.resolveClassMemberType(classDecl, propName);
      if (!memberType) continue;

      const filePath = this.resolveTypeToFilePath(memberType);
      if (!filePath) continue;

      const key = `this.${propName}::${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      refs.push({ name: propName, filePath, kind: 'call' });
    }
  }

  private getSymbolNode(symbol: DetectedSymbol, sourceFile: SourceFile): Node | undefined {
    if (symbol.kind === 'method' && symbol.containingClass) {
      return sourceFile.getClass(symbol.containingClass)?.getMethod(symbol.name);
    }

    const fn = sourceFile.getFunction(symbol.name);
    if (fn) return fn;

    for (const varDecl of sourceFile.getVariableDeclarations()) {
      if (varDecl.getName() !== symbol.name) continue;
      const init = varDecl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        return init;
      }
    }

    return undefined;
  }

  private getSymbolBody(
    node: MethodDeclaration | FunctionDeclaration | FunctionExpression | ArrowFunction | Node,
  ): Node | undefined {
    if (
      Node.isMethodDeclaration(node)
      || Node.isFunctionDeclaration(node)
      || Node.isFunctionExpression(node)
    ) {
      return node.getBody();
    }
    if (Node.isArrowFunction(node)) {
      return node.getBody();
    }
    return undefined;
  }

  private getContainingClass(symbolNode: Node, sourceFile: SourceFile): ClassDeclaration | undefined {
    const classNode = symbolNode.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    if (classNode) return classNode;

    if (Node.isMethodDeclaration(symbolNode) && symbolNode.getParentIfKind(SyntaxKind.ClassDeclaration)) {
      return symbolNode.getParentIfKind(SyntaxKind.ClassDeclaration);
    }

    return sourceFile.getClasses()[0];
  }

  private resolveClassMemberType(classDecl: ClassDeclaration, propName: string): Type | undefined {
    for (const ctor of classDecl.getConstructors()) {
      for (const param of ctor.getParameters()) {
        if (param.getName() === propName) {
          return param.getType();
        }
      }
    }

    for (const prop of classDecl.getProperties()) {
      if (prop.getName() === propName) {
        return prop.getType();
      }
    }

    return undefined;
  }

  private resolveTypeToFilePath(type: Type): string | undefined {
    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    if (!symbol) return undefined;

    const name = symbol.getName();
    if (name === '__type' || name === '__object' || name === 'Object') return undefined;

    for (const decl of symbol.getDeclarations()) {
      const filePath = decl.getSourceFile().getFilePath();
      if (this.isExternalDeclaration(filePath)) continue;
      return filePath;
    }

    return undefined;
  }

  private isExternalDeclaration(filePath: string): boolean {
    if (filePath.includes('node_modules')) return true;
    const base = path.basename(filePath);
    if (base.startsWith('lib.') && filePath.endsWith('.d.ts')) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Used By — two-tier: VS Code language API (Tier 1), ts-morph scan (Tier 2)
  // ---------------------------------------------------------------------------

  private async resolveUsedBy(symbol: DetectedSymbol): Promise<DependencyRef[]> {
    const vscodeRefs = await this.vscodeReferences(symbol);
    if (vscodeRefs.length > 0) {
      return vscodeRefs.slice(0, MAX_REFS);
    }

    return this.tsMorphReferences(symbol);
  }

  private async vscodeReferences(symbol: DetectedSymbol): Promise<DependencyRef[]> {
    try {
      const uri = vscode.Uri.file(symbol.location.filePath);
      const pos = new vscode.Position(symbol.location.startLine - 1, symbol.location.nameColumn);

      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        pos,
      );

      if (!locations || locations.length === 0) return [];

      const refs: DependencyRef[] = [];
      const seen = new Set<string>();

      for (const loc of locations) {
        const refPath = loc.uri.fsPath;
        if (refPath === symbol.location.filePath) continue;
        if (seen.has(refPath)) continue;
        seen.add(refPath);

        refs.push({ name: symbol.name, filePath: refPath, kind: 'reference' });
        if (refs.length >= MAX_REFS) break;
      }

      return refs;
    } catch {
      return [];
    }
  }

  private tsMorphReferences(symbol: DetectedSymbol): DependencyRef[] {
    const refs: DependencyRef[] = [];
    const seen = new Set<string>();
    const symbolName = symbol.name;

    for (const sf of this.project.getSourceFiles()) {
      const sfPath = sf.getFilePath();
      if (sfPath === symbol.location.filePath) continue;

      if (!sf.getFullText().includes(symbolName)) continue;

      const hasRef = sf.getDescendantsOfKind(SyntaxKind.Identifier).some(
        (id) => id.getText() === symbolName,
      );

      if (hasRef && !seen.has(sfPath)) {
        seen.add(sfPath);
        refs.push({ name: symbolName, filePath: sfPath, kind: 'reference' });
        if (refs.length >= MAX_REFS) break;
      }
    }

    return refs;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getOrAdd(filePath: string): SourceFile | undefined {
    const existing = this.project.getSourceFile(filePath);
    if (existing) return existing;
    try {
      return this.project.addSourceFileAtPath(filePath);
    } catch {
      return undefined;
    }
  }

  private resolveModulePath(moduleSpecifier: string, fromFile: string): string {
    if (moduleSpecifier.startsWith('.')) {
      const dir = path.dirname(fromFile);
      const resolved = path.resolve(dir, moduleSpecifier);
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        const candidate = resolved + ext;
        if (existsSync(candidate)) return candidate;
        if (this.project.getSourceFile(candidate)) return candidate;
      }
      return resolved;
    }
    return moduleSpecifier;
  }
}
