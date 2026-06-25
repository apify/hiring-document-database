// After the two `tsc` builds, Node still needs to know how to interpret the
// emitted `.js` files. We drop a tiny `package.json` into each output folder
// so Node treats `dist/cjs/*.js` as CommonJS and `dist/esm/*.js` as ES modules,
// regardless of the root package's "type" field.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const markers = [
  ['dist/cjs/package.json', { type: 'commonjs' }],
  ['dist/esm/package.json', { type: 'module' }],
];

for (const [relPath, contents] of markers) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${JSON.stringify(contents, null, 2)}\n`);
}

console.log('Wrote dist/cjs and dist/esm package.json markers.');
