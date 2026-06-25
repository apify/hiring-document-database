import { beforeEach, describe, expect, it } from 'vitest';

import { Collection, Database, eq, gt, gte, lt, lte, ne } from '../src/index.js';
import type { Document } from '../src/index.js';

async function collect(iter: AsyncIterable<Document>): Promise<Document[]> {
  const out: Document[] = [];
  for await (const doc of iter) out.push(doc);
  return out;
}

function names(docs: Document[]): string[] {
  return docs.map((d) => d.name as string).sort();
}

describe('list + filter', () => {
  let people: Collection;

  beforeEach(async () => {
    people = await new Database().newCollection('people');
    await people.insert({ _id: '1', name: 'Ada', age: 36, country: 'UK' });
    await people.insert({ _id: '2', name: 'Babbage', age: 49, country: 'UK' });
    await people.insert({ _id: '3', name: 'Turing', age: 41, country: 'UK' });
    await people.insert({ _id: '4', name: 'Hopper', age: 85, country: 'US' });
  });

  it('returns an async iterator over all documents for an empty filter', async () => {
    const all = await collect(people.list());
    expect(all).toHaveLength(4);
  });

  it('filters by equality on a single field', async () => {
    const result = await collect(people.list({ country: 'US' }));
    expect(names(result)).toEqual(['Hopper']);
  });

  it('ANDs multiple filter keys', async () => {
    const result = await collect(people.list({ country: 'UK', age: gt(40) }));
    expect(names(result)).toEqual(['Babbage', 'Turing']);
  });

  it('supports gt / gte / lt / lte', async () => {
    expect(names(await collect(people.list({ age: gt(49) })))).toEqual(['Hopper']);
    expect(names(await collect(people.list({ age: gte(49) })))).toEqual([
      'Babbage',
      'Hopper',
    ]);
    expect(names(await collect(people.list({ age: lt(41) })))).toEqual(['Ada']);
    expect(names(await collect(people.list({ age: lte(41) })))).toEqual([
      'Ada',
      'Turing',
    ]);
  });

  it('supports ne', async () => {
    expect(names(await collect(people.list({ country: ne('UK') })))).toEqual([
      'Hopper',
    ]);
  });

  it('returns nothing when no document matches', async () => {
    expect(await collect(people.list({ age: gt(1000) }))).toEqual([]);
  });

  it('treats a non-comparable ordered comparison as no match', async () => {
    // age is a number; comparing against a string is not order-comparable.
    expect(await collect(people.list({ age: gt('abc') }))).toEqual([]);
  });

  it('matches nested values by structural (deep) equality', async () => {
    const cfg = await new Database().newCollection('cfg');
    await cfg.insert({ _id: 'a', meta: { tags: ['x', 'y'] } });
    await cfg.insert({ _id: 'b', meta: { tags: ['z'] } });
    const result = await collect(cfg.list({ meta: { tags: ['x', 'y'] } }));
    expect(result.map((d) => d._id)).toEqual(['a']);
  });

  it('snapshots at call time — writes after list() are not observed', async () => {
    const iter = people.list();
    await people.insert({ _id: '5', name: 'Lovelace', age: 30, country: 'UK' });
    const seen = await collect(iter);
    expect(seen).toHaveLength(4);
  });

  it('treats an explicit eq() helper like a bare value', async () => {
    expect(names(await collect(people.list({ country: eq('US') })))).toEqual([
      'Hopper',
    ]);
  });

  it('yields independent copies — mutating a result does not affect storage', async () => {
    const [first] = await collect(people.list({ _id: '1' }));
    (first as Document).name = 'mutated';
    expect((await people.get('1'))?.name).toBe('Ada');
  });

  it('is re-iterable by calling list again', async () => {
    expect(await collect(people.list({ country: 'US' }))).toHaveLength(1);
    expect(await collect(people.list({ country: 'US' }))).toHaveLength(1);
  });
});
