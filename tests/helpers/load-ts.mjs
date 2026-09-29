import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(tmpdir(), `prometheus-tests-${process.pid}`);
const done = new Set();

/** Transpile a pure TypeScript module and its relative imports, then import it. */
export async function loadTs(path) {
  const entry = resolve(root, path);
  transpile(entry);
  return import(pathToFileURL(join(out, relative(root, entry)).replace(/\.ts$/, '.js')).href);
}

function transpile(file) {
  if (done.has(file)) return;
  done.add(file);
  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const target = join(out, relative(root, file)).replace(/\.ts$/, '.js');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, outputText);
  for (const match of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)\.js['"]/g)) {
    transpile(resolve(dirname(file), `${match[1]}.ts`));
  }
}
