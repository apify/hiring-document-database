import { beforeEach, describe, expect, it } from 'vitest';

import { Collection, Database, InvalidUpdateError } from '../src/index.js';
import type { Document } from '../src/index.js';

async function collect(iter: AsyncIterable<Document>): Promise<Document[]> {
  const out: Document[] = [];
  for await (const doc of iter) out.push(doc);
  return out;
}

describe('path safety (prototype pollution)', () => {
  let c: Collection;

  beforeEach(async () => {
    c = await new Database().newCollection('c');
    await c.insert({ _id: '1', name: 'Ada' });
  });

  it('rejects an update whose dot-path uses __proto__', async () => {
    await expect(
      c.update({ _id: '1' }, { '__proto__.polluted': 'yes' }),
    ).rejects.toBeInstanceOf(InvalidUpdateError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects an update whose dot-path uses constructor.prototype', async () => {
    await expect(
      c.update({ _id: '1' }, { 'constructor.prototype.polluted': 'yes' }),
    ).rejects.toBeInstanceOf(InvalidUpdateError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a __proto__ key arriving from parsed JSON', async () => {
    // JSON.parse creates a real own "__proto__" key (the classic pollution
    // payload from an untrusted request body), unlike an object literal.
    const changes = JSON.parse('{"__proto__": {"polluted": "yes"}}');
    await expect(c.update({ _id: '1' }, changes)).rejects.toBeInstanceOf(
      InvalidUpdateError,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('never reads inherited members through a filter', async () => {
    // Every object inherits `constructor`/`toString`, but filtering on them
    // must not match, since they are not own document fields.
    expect(await collect(c.list({ constructor: Object }))).toEqual([]);
    expect(await collect(c.list({ toString: ({} as Document).toString }))).toEqual(
      [],
    );
  });

  it('still supports an own field that happens to be named "constructor"', async () => {
    await c.insert({ _id: '2', constructor: 'custom' });
    const matched = await collect(c.list({ constructor: 'custom' }));
    expect(matched.map((d) => d._id)).toEqual(['2']);
  });
});
