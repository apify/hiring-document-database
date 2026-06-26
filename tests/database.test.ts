import { describe, expect, it } from 'vitest';

import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  Collection,
  Database,
} from '../src/index.js';

describe('Database', () => {
  it('creates a new collection and returns it', async () => {
    const db = new Database();
    const users = await db.newCollection('users');
    expect(users).toBeInstanceOf(Collection);
    expect(users.name).toBe('users');
    expect(db.hasCollection('users')).toBe(true);
  });

  it('throws when creating a collection that already exists', async () => {
    const db = new Database();
    await db.newCollection('users');
    await expect(db.newCollection('users')).rejects.toBeInstanceOf(
      CollectionAlreadyExistsError,
    );
  });

  it('returns an existing collection via collection()', async () => {
    const db = new Database();
    const created = await db.newCollection('users');
    expect(db.collection('users')).toBe(created);
  });

  it('throws when accessing a missing collection', () => {
    const db = new Database();
    expect(() => db.collection('nope')).toThrow(CollectionNotFoundError);
  });

  it('removes a collection', async () => {
    const db = new Database();
    await db.newCollection('users');
    await db.removeCollection('users');
    expect(db.hasCollection('users')).toBe(false);
  });

  it('throws when removing a missing collection', async () => {
    const db = new Database();
    await expect(db.removeCollection('nope')).rejects.toBeInstanceOf(
      CollectionNotFoundError,
    );
  });

  it('lists collection names in insertion order', async () => {
    const db = new Database();
    await db.newCollection('a');
    await db.newCollection('b');
    expect(db.listCollections()).toEqual(['a', 'b']);
  });

  it('drops all data when a collection is removed and re-created', async () => {
    const db = new Database();
    const c = await db.newCollection('c');
    await c.insert({ _id: 'x' });
    await db.removeCollection('c');
    const fresh = await db.newCollection('c'); // same name is free again
    expect(fresh.size).toBe(0);
    expect(await fresh.get('x')).toBeNull();
  });
});
