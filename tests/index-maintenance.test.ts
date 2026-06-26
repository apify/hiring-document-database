import { performance } from 'node:perf_hooks';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  DuplicateKeyError,
  dec,
  inc,
} from '../src/index.js';
import type { Document } from '../src/index.js';

async function values(c: Collection, field = 'n'): Promise<number[]> {
  const docs = await c.list().toArray();
  return docs.map((d) => d[field] as number).sort((a, b) => a - b);
}

describe('incremental unique-index maintenance', () => {
  let c: Collection;

  beforeEach(async () => {
    c = await new Database().newCollection('c');
    await c.ensureIndex({ n: 1 }, { unique: true });
    await c.insert({ _id: 'a', n: 1 });
    await c.insert({ _id: 'b', n: 2 });
    await c.insert({ _id: 'd', n: 3 });
  });

  describe('cascading updates (a key held by another updated document)', () => {
    it('increments every document by one without a false collision', async () => {
      const count = await c.update({}, { n: inc(1) });
      expect(count).toBe(3);
      expect(await values(c)).toEqual([2, 3, 4]);
    });

    it('decrements every document by one without a false collision', async () => {
      const count = await c.update({}, { n: dec(1) });
      expect(count).toBe(3);
      expect(await values(c)).toEqual([0, 1, 2]);
    });
  });

  describe('genuine conflicts are rejected atomically', () => {
    it('rejects collapsing several documents onto the same value', async () => {
      await expect(c.update({}, { n: 5 })).rejects.toBeInstanceOf(
        DuplicateKeyError,
      );
      expect(await values(c)).toEqual([1, 2, 3]); // unchanged
    });

    it('rejects moving a document onto a value held by an unchanged one', async () => {
      await expect(c.update({ n: 1 }, { n: 2 })).rejects.toBeInstanceOf(
        DuplicateKeyError,
      );
      expect(await values(c)).toEqual([1, 2, 3]); // unchanged
    });

    it('leaves the index map uncorrupted after a rejected update', async () => {
      await expect(c.update({ n: 1 }, { n: 2 })).rejects.toBeInstanceOf(
        DuplicateKeyError,
      );
      // Both original keys must still be owned by their original holders.
      await expect(c.insert({ n: 1 })).rejects.toBeInstanceOf(DuplicateKeyError);
      await expect(c.insert({ n: 2 })).rejects.toBeInstanceOf(DuplicateKeyError);
      expect((await c.get('a'))?.n).toBe(1);
      expect((await c.get('b'))?.n).toBe(2);
    });
  });

  describe('keys are freed when vacated', () => {
    it('allows reusing a value after an update moves a document off it', async () => {
      await c.update({ n: 1 }, { n: 10 });
      await expect(c.insert({ _id: 'e', n: 1 })).resolves.toBeDefined();
      expect(await values(c)).toEqual([1, 2, 3, 10]);
    });

    it('allows reusing a value after the holder is deleted', async () => {
      await c.delete('a'); // frees n=1
      await expect(c.insert({ _id: 'e', n: 1 })).resolves.toBeDefined();
    });

    it('accepts an update that leaves a document on its own value (no-op)', async () => {
      const count = await c.update({ n: 1 }, { n: 1 });
      expect(count).toBe(1);
      expect(await values(c)).toEqual([1, 2, 3]);
    });
  });

  describe('compound unique index stays consistent under updates', () => {
    it('cascades on the leading field of a compound key', async () => {
      const teams = await new Database().newCollection('teams');
      await teams.ensureIndex({ row: 1, seat: 1 }, { unique: true });
      await teams.insert({ _id: '1', row: 1, seat: 1 });
      await teams.insert({ _id: '2', row: 2, seat: 1 });
      await teams.insert({ _id: '3', row: 3, seat: 1 });
      // row: 1,2,3 -> 2,3,4 (seat constant); each lands where the next used to be.
      const count = await teams.update({}, { row: inc(1) });
      expect(count).toBe(3);
      expect(await values(teams, 'row')).toEqual([2, 3, 4]);
    });
  });
});

describe('write complexity is linear (not O(n^2))', () => {
  // These guard the persistent-index refactor. Under the old per-insert
  // full-collection rescan these would take tens of seconds; linear
  // maintenance keeps them well under a second. Bounds are deliberately loose
  // to stay robust on slow CI while still catching a quadratic regression.

  it('bulk insert with a unique index stays linear', async () => {
    const c = await new Database().newCollection('big');
    await c.ensureIndex({ k: 1 }, { unique: true });
    const N = 10_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) await c.insert({ k: i });
    const elapsed = performance.now() - start;

    expect(c.size).toBe(N);
    expect(await c.get((await c.list({ k: 7777 }).toArray())[0]!._id)).toMatchObject({ k: 7777 });
    expect(elapsed).toBeLessThan(2000);
  }, 20_000);

  it('bulk insert with no index stays linear', async () => {
    const c = await new Database().newCollection('big');
    const N = 40_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) await c.insert({ k: i });
    const elapsed = performance.now() - start;

    expect(c.size).toBe(N);
    expect(elapsed).toBeLessThan(2500);
  }, 20_000);

  it('seeding a database via the constructor stays linear', async () => {
    const docs: Document[] = [];
    for (let i = 0; i < 20_000; i++) docs.push({ _id: String(i), k: i });
    const start = performance.now();
    const db = new Database({ big: docs });
    const elapsed = performance.now() - start;

    expect(db.collection('big').size).toBe(20_000);
    expect(elapsed).toBeLessThan(2000);
  }, 20_000);
});
