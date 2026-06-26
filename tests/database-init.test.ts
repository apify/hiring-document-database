import { describe, expect, it } from 'vitest';

import {
  CollectionAlreadyExistsError,
  Database,
  DuplicateKeyError,
} from '../src/index.js';
import type { Document } from '../src/index.js';

async function collect(iter: AsyncIterable<Document>): Promise<Document[]> {
  const out: Document[] = [];
  for await (const doc of iter) out.push(doc);
  return out;
}

describe('Database initialization', () => {
  it('starts empty with no argument', () => {
    const db = new Database();
    expect(db.listCollections()).toEqual([]);
  });

  it('starts empty with an empty init object', () => {
    const db = new Database({});
    expect(db.listCollections()).toEqual([]);
  });

  it('creates collections pre-populated with documents', async () => {
    const db = new Database({
      users: [
        { _id: 'u1', name: 'Ada' },
        { _id: 'u2', name: 'Bob' },
      ],
    });
    const users = db.collection('users');
    expect(users.size).toBe(2);
    expect(await users.get('u1')).toEqual({ _id: 'u1', name: 'Ada' });
    expect((await collect(users.list())).map((d) => d._id).sort()).toEqual([
      'u1',
      'u2',
    ]);
  });

  it('creates an empty collection from an empty array', () => {
    const db = new Database({ logs: [] });
    expect(db.hasCollection('logs')).toBe(true);
    expect(db.collection('logs').size).toBe(0);
  });

  it('creates several collections at once', () => {
    const db = new Database({ users: [{ name: 'Ada' }], orders: [] });
    expect(db.listCollections()).toEqual(['users', 'orders']);
  });

  it('auto-generates _id for seed documents that omit it', async () => {
    const db = new Database({ users: [{ name: 'Ada' }] });
    const [doc] = await collect(db.collection('users').list());
    expect(typeof doc?._id).toBe('string');
    expect(doc?.name).toBe('Ada');
  });

  it('throws on a duplicate _id within a collection seed', () => {
    expect(
      () =>
        new Database({
          users: [
            { _id: 'dup', name: 'A' },
            { _id: 'dup', name: 'B' },
          ],
        }),
    ).toThrow(DuplicateKeyError);
  });

  it('copies seed documents — mutating the source afterwards does not leak', async () => {
    const source = { _id: 'u1', tags: ['a'] };
    const db = new Database({ users: [source] });
    source.tags.push('b');
    expect((await db.collection('users').get('u1'))?.tags).toEqual(['a']);
  });

  it('treats a pre-seeded name as taken by newCollection', async () => {
    const db = new Database({ users: [] });
    await expect(db.newCollection('users')).rejects.toBeInstanceOf(
      CollectionAlreadyExistsError,
    );
  });

  it('supports the full API on a pre-seeded collection', async () => {
    const db = new Database({ users: [{ _id: 'u1', visits: 1 }] });
    const users = db.collection('users');
    await users.ensureIndex({ _id: 1 }, { unique: true });
    await users.insert({ _id: 'u2', visits: 2 });
    await users.update({ _id: 'u1' }, { visits: 10 });
    expect((await users.get('u1'))?.visits).toBe(10);
    expect(await users.delete('u2')).toBe(true);
    expect(users.size).toBe(1);
  });
});
