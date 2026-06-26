import { beforeEach, describe, expect, it } from 'vitest';

import { Collection, Database, DocumentCursor, gt, gte } from '../src/index.js';

describe('list cursor: toArray + limit', () => {
  let people: Collection;

  beforeEach(async () => {
    people = await new Database().newCollection('people');
    for (let i = 1; i <= 5; i++) {
      await people.insert({ _id: String(i), n: i });
    }
  });

  it('list() returns a DocumentCursor', () => {
    expect(people.list()).toBeInstanceOf(DocumentCursor);
  });

  describe('toArray', () => {
    it('returns all matching documents', async () => {
      const all = await people.list().toArray();
      expect(all.map((d) => d.n)).toEqual([1, 2, 3, 4, 5]);
    });

    it('respects the filter', async () => {
      const some = await people.list({ n: gt(3) }).toArray();
      expect(some.map((d) => d._id).sort()).toEqual(['4', '5']);
    });

    it('returns [] when nothing matches', async () => {
      expect(await people.list({ n: gt(100) }).toArray()).toEqual([]);
    });

    it('returns copies — mutating a result does not affect storage', async () => {
      const [first] = await people.list({ _id: '1' }).toArray();
      (first as Record<string, unknown>).n = 999;
      expect((await people.get('1'))?.n).toBe(1);
    });
  });

  describe('limit', () => {
    it('caps the number of results and keeps order', async () => {
      const two = await people.list().limit(2).toArray();
      expect(two.map((d) => d.n)).toEqual([1, 2]);
    });

    it('returns everything when the limit exceeds the result set', async () => {
      expect(await people.list().limit(99).toArray()).toHaveLength(5);
    });

    it('treats limit(0) as no limit (MongoDB-style)', async () => {
      expect(await people.list().limit(0).toArray()).toHaveLength(5);
    });

    it('treats a negative limit as no limit', async () => {
      expect(await people.list().limit(-3).toArray()).toHaveLength(5);
    });

    it('is chainable and the cursor remains async-iterable', async () => {
      const seen: number[] = [];
      for await (const d of people.list().limit(3)) {
        seen.push(d.n as number);
      }
      expect(seen).toEqual([1, 2, 3]);
    });

    it('composes with a filter', async () => {
      const r = await people.list({ n: gte(2) }).limit(2).toArray();
      expect(r.map((d) => d.n)).toEqual([2, 3]);
    });

    it('the last limit() call wins when called more than once', async () => {
      const r = await people.list().limit(4).limit(1).toArray();
      expect(r.map((d) => d.n)).toEqual([1]);
    });
  });

  describe('iteration semantics', () => {
    it('snapshots at call time — writes after list() are not observed', async () => {
      const cursor = people.list();
      await people.insert({ _id: '6', n: 6 });
      expect(await cursor.toArray()).toHaveLength(5);
    });

    it('a cursor is single-pass — toArray drains it', async () => {
      const cursor = people.list();
      expect(await cursor.toArray()).toHaveLength(5);
      expect(await cursor.toArray()).toEqual([]); // already drained
    });

    it('toArray continues from where iteration left off', async () => {
      const cursor = people.list();
      const first = await cursor.next();
      expect(first.done).toBe(false);
      expect(first.value?.n).toBe(1);
      const rest = await cursor.toArray();
      expect(rest.map((d) => d.n)).toEqual([2, 3, 4, 5]);
    });
  });
});
