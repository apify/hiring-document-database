import { describe, expect, it } from 'vitest';

import { Database, gt, inc, unset } from '../src/index.js';

describe('integration', () => {
  it('supports a realistic end-to-end workflow', async () => {
    const db = new Database({ users: [] });
    const users = db.collection('users');
    await users.ensureIndex({ email: 1 }, { unique: true });

    await users.insert({ _id: 'u1', name: 'Ada', email: 'ada@x.com', age: 36 });
    await users.insert({ _id: 'u2', name: 'Bob', email: 'bob@x.com', age: 17 });
    await users.insert({ _id: 'u3', name: 'Cay', email: 'cay@x.com', age: 50 });

    // Tag and count the adults.
    const tagged = await users.update({ age: gt(18) }, { adult: true, visits: inc(1) });
    expect(tagged).toBe(2);
    const adults = await users.list({ adult: true }).toArray();
    expect(adults.map((u) => u.name).sort()).toEqual(['Ada', 'Cay']);

    // Unique email is still enforced; a colliding insert adds nothing.
    await expect(users.insert({ email: 'ada@x.com' })).rejects.toThrow();
    expect(users.size).toBe(3);

    // Remove a field, then a document.
    await users.update({ _id: 'u1' }, { adult: unset() });
    const u1 = await users.get('u1');
    expect(u1 && 'adult' in u1).toBe(false);

    expect(await users.delete('u2')).toBe(true);
    expect(users.size).toBe(2);
  });

  it('handles many concurrent inserts with distinct ids', async () => {
    const c = await new Database().newCollection('c');
    await Promise.all(
      Array.from({ length: 300 }, (_, i) => c.insert({ _id: `k${i}`, i })),
    );
    expect(c.size).toBe(300);
  });

  it('lets exactly one of several same-_id inserts win', async () => {
    const c = await new Database().newCollection('c');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => c.insert({ _id: 'dup' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
    expect(c.size).toBe(1);
  });

  it('auto-generates unique ids across many inserts', async () => {
    const c = await new Database().newCollection('c');
    for (let i = 0; i < 500; i++) await c.insert({ i });
    const ids = new Set((await c.list().toArray()).map((d) => d._id));
    expect(ids.size).toBe(500);
  });

  it('matches nested objects by deep equality regardless of key order', async () => {
    const c = await new Database().newCollection('c');
    await c.insert({ _id: '1', meta: { a: 1, b: { c: 2, d: 3 } } });
    const hit = await c.list({ meta: { b: { d: 3, c: 2 }, a: 1 } }).toArray();
    expect(hit.map((d) => d._id)).toEqual(['1']);
  });
});
