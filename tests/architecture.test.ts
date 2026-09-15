import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const scriptsRoot = path.join(root, 'scripts');

function collectFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? (['node_modules','dist'].includes(entry.name) ? [] : collectFiles(target, extension)) : target.endsWith(extension) ? [target] : [];
  });
}

function relativeName(filename: string): string {
  return path.relative(root, filename).replaceAll('\\', '/');
}

function resolveImport(importer: string, specifier: string): string | undefined {
  const packages: Record<string,string> = { '@ironfronts/protocol':'packages/protocol/src/index.ts', '@ironfronts/game-core':'packages/game-core/src/index.ts' };
  if (packages[specifier]) return path.join(root, packages[specifier]);
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.mjs`, path.join(base, 'index.ts'), path.join(base, 'index.mjs')]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function dependencies(filename: string): string[] {
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.every((entry) => entry.isTypeOnly)) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.every((entry) => entry.isTypeOnly)) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports.map((specifier) => resolveImport(filename, specifier))
    .filter((dependency): dependency is string => dependency !== undefined);
}

function findCycles(files: string[]): string[][] {
  const included = new Set(files);
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (filename: string): void => {
    if (active.has(filename)) {
      const start = stack.indexOf(filename);
      cycles.push([...stack.slice(start), filename].map(relativeName));
      return;
    }
    if (visited.has(filename)) return;
    visited.add(filename);
    active.add(filename);
    stack.push(filename);
    for (const dependency of dependencies(filename)) {
      if (included.has(dependency)) visit(dependency);
    }
    stack.pop();
    active.delete(filename);
  };
  for (const filename of files) visit(filename);
  return cycles;
}

describe('module architecture', () => {
  const sourceFiles = ['src', 'apps', 'packages'].flatMap((directory) => collectFiles(path.join(root,directory), '.ts'));
  const scriptFiles = collectFiles(scriptsRoot, '.mjs');

  it('contains no circular imports in runtime or tooling', () => {
    expect(findCycles(sourceFiles)).toEqual([]);
    expect(findCycles(scriptFiles)).toEqual([]);
  });

  it('keeps shader modules independent from renderer and domain code', () => {
    const shaderRoot = path.join(sourceRoot, 'shaders');
    const allowedSharedDependencies = new Set([path.join(sourceRoot, 'rendering', 'world-fog.ts')]);
    const violations = sourceFiles
      .filter((filename) => filename.startsWith(shaderRoot))
      .flatMap((filename) => dependencies(filename)
        .filter((dependency) => !dependency.startsWith(shaderRoot) && !allowedSharedDependencies.has(dependency))
        .map((dependency) => `${relativeName(filename)} -> ${relativeName(dependency)}`));
    expect(violations).toEqual([]);
  });

  it('keeps entrypoints at the dependency root', () => {
    const entrypoints = new Set([
      path.join(sourceRoot, 'main.ts'),
      path.join(scriptsRoot, 'build-world.mjs'),
      path.join(scriptsRoot, 'visual-check.mjs'),
      path.join(scriptsRoot, 'performance-check.mjs'),
    ]);
    const violations = [...sourceFiles, ...scriptFiles].flatMap((filename) => dependencies(filename)
      .filter((dependency) => entrypoints.has(dependency) && relativeName(filename) !== 'apps/client/src/main.ts')
      .map((dependency) => `${relativeName(filename)} -> ${relativeName(dependency)}`));
    expect(violations).toEqual([]);
  });

  it('keeps generator and QA tooling independent from browser runtime modules', () => {
    const violations = scriptFiles.flatMap((filename) => dependencies(filename)
      .filter((dependency) => dependency.startsWith(sourceRoot))
      .map((dependency) => `${relativeName(filename)} -> ${relativeName(dependency)}`));
    expect(violations).toEqual([]);
  });

  it('keeps the authoritative game layer independent from renderer, HUD and shaders', () => {
    // src/game/** owns gameplay state. It must not depend on the renderer,
    // the entrypoint, the HUD, or any GPU shader module — those are
    // presentation/cache layers that read a projection of game state.
    const gameRoot = path.join(sourceRoot, 'game');
    const forbidden = [
      path.join(sourceRoot, 'renderer.ts'),
      path.join(sourceRoot, 'rendering'),
      path.join(sourceRoot, 'main.ts'),
      path.join(sourceRoot, 'shaders'),
      path.join(sourceRoot, 'ui'),
    ];
    const violations = sourceFiles
      .filter((filename) => filename.startsWith(gameRoot))
      .flatMap((filename) => dependencies(filename)
        .filter((dependency) => forbidden.some(
          (bad) => dependency === bad || dependency.startsWith(`${bad}${path.sep}`),
        ))
        .map((dependency) => `${relativeName(filename)} -> ${relativeName(dependency)}`));
    expect(violations).toEqual([]);
  });

  it('keeps the game layer free of browser globals so it can run in Node', () => {
    // The server-ready promise: GameSession + rules must import
    // nothing browser-only AND touch no browser global. Guards against a stray
    // `window.`/`document.`/`localStorage.` creeping into a rules module.
    const gameRoot = path.join(sourceRoot, 'game');
    const browserGlobal = /\b(?:window|document|localStorage|sessionStorage|navigator|requestAnimationFrame)\s*\./;
    const violations = sourceFiles
      .filter((filename) => filename.startsWith(gameRoot))
      .filter((filename) => browserGlobal.test(
        readFileSync(filename, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''),
      ))
      .map(relativeName);
    expect(violations).toEqual([]);
  });

  it('keeps country domain modules independent from renderer orchestration', () => {
    const countryRoot = path.join(sourceRoot, 'country-labels');
    const violations = sourceFiles
      .filter((filename) => filename.startsWith(countryRoot))
      .flatMap((filename) => dependencies(filename)
        .filter((dependency) => /(?:renderer|main)\.ts$/.test(dependency))
        .map((dependency) => `${relativeName(filename)} -> ${relativeName(dependency)}`));
    expect(violations).toEqual([]);
  });

  it('keeps the source root limited to stable entries and declarations', () => {
    const allowed = new Set(['main.ts', 'renderer.ts', 'styles.css', 'wgsl-reflect.d.ts']);
    const rootFiles = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    expect(rootFiles.filter((filename) => !allowed.has(filename))).toEqual([]);
  });

  it('keeps UI and rendering independent from application orchestration', () => {
    const appRoot = path.join(sourceRoot, 'app');
    const presentationRoots = [path.join(sourceRoot, 'ui'), path.join(sourceRoot, 'rendering')];
    const violations = sourceFiles
      .filter((filename) => presentationRoots.some((directory) => filename.startsWith(directory)))
      .flatMap((filename) => dependencies(filename)
        .filter((dependency) => dependency.startsWith(appRoot))
        .map((dependency) => `${relativeName(filename)} -> ${relativeName(dependency)}`));
    expect(violations).toEqual([]);
  });
});
