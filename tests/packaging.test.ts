import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// These tests exercise the *built* output (the published artifact), not the
// TypeScript source. They are skipped when `dist/` has not been built yet; run
// `npm run build` first (the package's `prepare` script does this on install).
const root = process.cwd();
const cjsEntry = join(root, 'dist', 'cjs', 'index.js');
const esmEntry = join(root, 'dist', 'esm', 'index.js');
const built = existsSync(cjsEntry) && existsSync(esmEntry);

const PUBLIC_FUNCTIONS = [
  'Database',
  'Collection',
  'gt',
  'lt',
  'inc',
  'unset',
  'DatabaseError',
];

describe.skipIf(!built)('packaging: built dual ESM + CJS output', () => {
  it('loads via require() (CommonJS) and round-trips a document', async () => {
    const require = createRequire(join(root, 'package.json'));
    const mod = require(cjsEntry);
    expect(typeof mod.Database).toBe('function');
    const db = new mod.Database({ users: [{ _id: 'u1', n: 1 }] });
    const stored = await db.collection('users').get('u1');
    expect(stored.n).toBe(1);
  });

  it('loads via import() (ESM) and exposes the public surface', async () => {
    const mod = await import(esmEntry);
    for (const name of PUBLIC_FUNCTIONS) {
      expect(typeof mod[name]).toBe('function');
    }
  });
});
