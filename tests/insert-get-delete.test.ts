import { beforeEach, describe, expect, it } from 'vitest';

import { Collection, Database, DuplicateKeyError } from '../src/index.js';

describe('insert / get / delete', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
  });

  it('auto-generates a unique _id when none is provided', async () => {
    const a = await users.insert({ name: 'Ada' });
    const b = await users.insert({ name: 'Babbage' });
    expect(typeof a._id).toBe('string');
    expect(a._id).not.toBe(b._id);
  });

  it('keeps a caller-provided _id', async () => {
    const doc = await users.insert({ _id: 'u1', name: 'Ada' });
    expect(doc._id).toBe('u1');
  });

  it('throws on a duplicate _id', async () => {
    await users.insert({ _id: 'u1', name: 'Ada' });
    await expect(users.insert({ _id: 'u1', name: 'Other' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('get returns the stored document by _id', async () => {
    const inserted = await users.insert({ _id: 'u1', name: 'Ada' });
    expect(await users.get('u1')).toEqual(inserted);
  });

  it('get returns null for a missing _id', async () => {
    expect(await users.get('missing')).toBeNull();
  });

  it('delete returns true when a document existed, false otherwise', async () => {
    await users.insert({ _id: 'u1', name: 'Ada' });
    expect(await users.delete('u1')).toBe(true);
    expect(await users.delete('u1')).toBe(false);
    expect(await users.get('u1')).toBeNull();
  });

  it('stores a copy — mutating the input after insert does not affect storage', async () => {
    const input: { _id: string; tags: string[] } = { _id: 'u1', tags: ['a'] };
    await users.insert(input);
    input.tags.push('b');
    const stored = await users.get('u1');
    expect(stored?.tags).toEqual(['a']);
  });

  it('returns a copy — mutating a read result does not affect storage', async () => {
    await users.insert({ _id: 'u1', tags: ['a'] });
    const first = await users.get('u1');
    (first?.tags as string[]).push('b');
    const second = await users.get('u1');
    expect(second?.tags).toEqual(['a']);
  });
});
