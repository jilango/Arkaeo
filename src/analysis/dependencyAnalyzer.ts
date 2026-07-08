import * as vscode from 'vscode';
import * as path from 'path';
import { Project, Node, SourceFile } from 'ts-morph';
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
  // Depends On — imports and calls made within the symbol's body
  // ---------------------------------------------------------------------------

  private resolveDependsOn(symbol: DetectedSymbol): DependencyRef[] {
    const sourceFile = this.getOrAdd(symbol.location.filePath);
    if (!sourceFile) return [];

    const refs: DependencyRef[] = [];
    const seen = new Set<string>();

    // Collect all import declarations and build a map: localName → moduleSpecifier
    const importMap = new Map<string, string>();
    for (const imp of sourceFile.getImportDeclarations()) {
      const mod = imp.getModuleSpecifierValue();
      // Default import
      const defaultImport = imp.getDefaultImport();
      if (defaultImport) importMap.set(defaultImport.getText(), mod);
      // Named imports
      for (const named of imp.getNamedImports()) {
        importMap.set(named.getAliasNode()?.getText() ?? named.getName(), mod);
      }
      // Namespace import
      const nsImport = imp.getNamespaceImport();
      if (nsImport) importMap.set(nsImport.getText(), mod);
    }

    // Find the symbol's node range so we can restrict identifier scanning
    const { startLine, endLine } = symbol.location;

    const allIdentifiers = sourceFile.getDescendantsOfKind(
      // SyntaxKind.Identifier = 80
      80,
    );

    for (const id of allIdentifiers) {
      const line = id.getStartLineNumber();
      if (line < startLine || line > endLine) continue;

      const name = id.getText();
      const mod = importMap.get(name);
      if (!mod) continue;

      const key = `${name}::${mod}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const resolvedPath = this.resolveModulePath(mod, symbol.location.filePath);
      refs.push({ name, filePath: resolvedPath, kind: 'import' });
    }

    return refs;
  }

  // ---------------------------------------------------------------------------
  // Used By — two-tier: VS Code language API (Tier 1), ts-morph scan (Tier 2)
  // ---------------------------------------------------------------------------

  private async resolveUsedBy(symbol: DetectedSymbol): Promise<DependencyRef[]> {
    // Tier 1: VS Code reference provider (LSP-backed, most accurate)
    const vscodeRefs = await this.vscodeReferences(symbol);
    if (vscodeRefs.length > 0) {
      return vscodeRefs.slice(0, MAX_REFS);
    }

    // Tier 2: ts-morph text scan (fallback when LSP has no results)
    return this.tsMorphReferences(symbol);
  }

  private async vscodeReferences(symbol: DetectedSymbol): Promise<DependencyRef[]> {
    try {
      const uri = vscode.Uri.file(symbol.location.filePath);
      // startLine is 1-based (ts-morph); VS Code Position is 0-based.
      // nameColumn is the exact 0-based column of the identifier token so the
      // reference provider lands on the name rather than a keyword or whitespace.
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
        // Exclude the definition file itself
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

      // Quick text check before walking the AST
      if (!sf.getFullText().includes(symbolName)) continue;

      const hasRef = sf.getDescendantsOfKind(80).some(
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

  /**
   * Resolves a module specifier to an absolute path.
   * Relative paths are resolved from the importing file's directory.
   * Non-relative (node_modules / built-in) paths are returned as-is.
   */
  private resolveModulePath(moduleSpecifier: string, fromFile: string): string {
    if (moduleSpecifier.startsWith('.')) {
      const dir = path.dirname(fromFile);
      const resolved = path.resolve(dir, moduleSpecifier);
      // Try common extensions
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        const candidate = resolved + ext;
        try {
          if (this.project.getSourceFile(candidate)) return candidate;
        } catch {
          // continue
        }
      }
      return resolved;
    }
    // External or built-in module — return the specifier as the "path"
    return moduleSpecifier;
  }
}
