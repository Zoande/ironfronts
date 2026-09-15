import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceDirectories = ['src', 'apps', 'packages'];
const ignoredDirectories = new Set(['node_modules', 'dist']);

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(target);
    return target.endsWith('.ts') && !target.endsWith('.d.ts') ? [path.resolve(target)] : [];
  });
}

const files = sourceDirectories.flatMap((directory) => collect(path.join(root, directory)));
const fileSet = new Set(files);
const aliases = new Map([
  ['@ironfronts/protocol', path.resolve(root, 'packages/protocol/src/index.ts')],
  ['@ironfronts/protocol/ticket', path.resolve(root, 'packages/protocol/src/ticket.ts')],
  ['@ironfronts/game-core', path.resolve(root, 'packages/game-core/src/index.ts')],
]);

function resolveModule(importer, specifier) {
  if (aliases.has(specifier)) return aliases.get(specifier);
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(importer), specifier);
  const withoutJs = base.replace(/\.js$/, '');
  return [base, `${base}.ts`, withoutJs, `${withoutJs}.ts`, path.join(base, 'index.ts')]
    .find((candidate) => fileSet.has(candidate));
}

function dependencies(filename) {
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const dependency = resolveModule(filename, node.moduleSpecifier.text);
      if (dependency) result.push(dependency);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const dependency = resolveModule(filename, node.arguments[0].text);
      if (dependency) result.push(dependency);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

const roots = [
  'apps/client/src/main.ts', 'apps/client/src/login.ts',
  'apps/auth-server/src/main.ts', 'apps/game-server/src/main.ts',
  'packages/protocol/src/index.ts', 'packages/protocol/src/ticket.ts',
  'packages/game-core/src/index.ts',
].map((filename) => path.resolve(root, filename)).filter(existsSync);
const reachable = new Set();
function visit(filename) {
  if (reachable.has(filename)) return;
  reachable.add(filename);
  for (const dependency of dependencies(filename)) visit(dependency);
}
for (const entrypoint of roots) visit(entrypoint);

const unreachable = files.filter((filename) => !reachable.has(filename));
if (unreachable.length) {
  console.error('Runtime TypeScript modules unreachable from an application or package entrypoint:');
  for (const filename of unreachable) console.error(`- ${path.relative(root, filename).replaceAll('\\', '/')}`);
  process.exitCode = 1;
} else {
  console.log(`Dead-code reachability check passed (${files.length} runtime modules).`);
}
