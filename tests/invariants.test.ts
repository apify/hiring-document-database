import { describe, expect, it } from 'vitest';

import { Database } from '../src/index.js';

/** Small deterministic PRNG (mulberry32) so a failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('invariants under randomized operations', () => {
  it('preserves _id and unique-key invariants across many insert/update/delete ops', async () => {
    const c = await new Database().newCollection('c');
    await c.ensureIndex({ k: 1 }, { unique: true });

    const rand = mulberry32(0xc0ffee);
    const pick = (n: number) => Math.floor(rand() * n);

    for (let i = 0; i < 4000; i++) {
      const id = `id${pick(60)}`;
      const k = pick(30);
      const roll = rand();
      try {
        if (roll < 0.55) await c.insert({ _id: id, k });
        else if (roll < 0.8) await c.update({ _id: id }, { k });
        else await c.delete(id);
      } catch {
        // Duplicate _id / duplicate-key collisions are expected and fine.
      }
    }

    const docs = await c.list().toArray();

    // The reported size agrees with what is actually listable.
    expect(docs).toHaveLength(c.size);

    // Every _id is unique and individually retrievable.
    const ids = docs.map((d) => d._id);
    expect(new Set(ids).size).toBe(docs.length);
    for (const d of docs) {
      expect(await c.get(d._id)).toEqual(d);
    }

    // The unique-index invariant holds: no two documents share a `k`.
    const ks = docs.map((d) => d.k);
    expect(new Set(ks).size).toBe(docs.length);
  });

  it('is reproducible — two identical seeded runs reach the same state', async () => {
    const run = async () => {
      const c = await new Database().newCollection('c');
      await c.ensureIndex({ k: 1 }, { unique: true });
      const rand = mulberry32(42);
      const pick = (n: number) => Math.floor(rand() * n);
      for (let i = 0; i < 1500; i++) {
        const id = `id${pick(40)}`;
        const k = pick(20);
        const roll = rand();
        try {
          if (roll < 0.6) await c.insert({ _id: id, k });
          else if (roll < 0.8) await c.update({ _id: id }, { k });
          else await c.delete(id);
        } catch {
          /* expected */
        }
      }
      return (await c.list().toArray())
        .map((d) => `${d._id}:${d.k}`)
        .sort();
    };
    expect(await run()).toEqual(await run());
  });
});
