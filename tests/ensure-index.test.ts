import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  DatabaseError,
  DuplicateKeyError,
} from '../src/index.js';

describe('ensureIndex', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
  });

  it('records direction and uniqueness via listIndexes', async () => {
    await users.ensureIndex({ lastName: 1, firstName: -1 });
    await users.ensureIndex({ email: 1 }, { unique: true });
    expect(users.listIndexes()).toEqual([
      { fields: ['lastName', 'firstName'], spec: { lastName: 1, firstName: -1 }, unique: false },
      { fields: ['email'], spec: { email: 1 }, unique: true },
    ]);
  });

  it('enforces a unique index on insert', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.insert({ email: 'a@x.com' });
    await expect(users.insert({ email: 'a@x.com' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('allows duplicates on a non-unique index', async () => {
    await users.ensureIndex({ country: 1 });
    await users.insert({ country: 'CZ' });
    await expect(users.insert({ country: 'CZ' })).resolves.toBeDefined();
  });

  it('enforces a compound unique index over the combination of fields', async () => {
    await users.ensureIndex({ team: 1, seat: 1 }, { unique: true });
    await users.insert({ team: 'a', seat: 1 });
    await users.insert({ team: 'a', seat: 2 }); // same team, different seat: ok
    await users.insert({ team: 'b', seat: 1 }); // different team, same seat: ok
    await expect(users.insert({ team: 'a', seat: 1 })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('refuses to create a unique index when existing data already violates it', async () => {
    await users.insert({ email: 'a@x.com' });
    await users.insert({ email: 'a@x.com' });
    await expect(
      users.ensureIndex({ email: 1 }, { unique: true }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    // The failed index must not have been registered.
    expect(users.listIndexes()).toEqual([]);
  });

  it('is idempotent for an identical spec and options, preserving the definition', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.ensureIndex({ email: 1 }, { unique: true });
    expect(users.listIndexes()).toEqual([
      { fields: ['email'], spec: { email: 1 }, unique: true },
    ]);
  });

  it('throws when the same fields are re-indexed with conflicting options', async () => {
    await users.ensureIndex({ email: 1 });
    await expect(
      users.ensureIndex({ email: 1 }, { unique: true }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects an empty spec', async () => {
    await expect(users.ensureIndex({})).rejects.toBeInstanceOf(DatabaseError);
  });

  it('rejects an invalid direction', async () => {
    await expect(
      // @ts-expect-error - 2 is not a valid SortDirection
      users.ensureIndex({ email: 2 }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it('treats a missing indexed field as a single null key (collides)', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.insert({ name: 'no-email-1' });
    await expect(users.insert({ name: 'no-email-2' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('accepts a descending direction', async () => {
    await users.ensureIndex({ score: -1 }, { unique: true });
    expect(users.listIndexes()[0]?.spec).toEqual({ score: -1 });
  });

  it('frees a unique key once its document is deleted', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    const first = await users.insert({ email: 'a@x.com' });
    await expect(users.insert({ email: 'a@x.com' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
    await users.delete(first._id);
    await expect(users.insert({ email: 'a@x.com' })).resolves.toBeDefined();
  });

  it('enforces several unique indexes simultaneously', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.ensureIndex({ username: 1 }, { unique: true });
    await users.insert({ email: 'a@x.com', username: 'ada' });
    await expect(
      users.insert({ email: 'a@x.com', username: 'other' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    await expect(
      users.insert({ email: 'other@x.com', username: 'ada' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    await expect(
      users.insert({ email: 'other@x.com', username: 'other' }),
    ).resolves.toBeDefined();
  });

  it('creates a unique index over already-valid data and then enforces it', async () => {
    await users.insert({ email: 'a@x.com' });
    await users.insert({ email: 'b@x.com' });
    await users.ensureIndex({ email: 1 }, { unique: true });
    expect(users.listIndexes()).toHaveLength(1);
    await expect(users.insert({ email: 'a@x.com' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('exposes the offending fields and value on the error', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.insert({ email: 'a@x.com' });
    await expect(users.insert({ email: 'a@x.com' })).rejects.toMatchObject({
      fields: ['email'],
      value: ['a@x.com'],
    });
  });

  it('distinguishes index values by type (number 1 vs string "1")', async () => {
    await users.ensureIndex({ k: 1 }, { unique: true });
    await users.insert({ k: 1 });
    await expect(users.insert({ k: '1' })).resolves.toBeDefined();
  });

  it('collides a missing indexed field with an explicit null', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.insert({ name: 'no email' }); // field missing
    await expect(users.insert({ email: null })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('treats object-valued index keys as equal regardless of key order', async () => {
    await users.ensureIndex({ meta: 1 }, { unique: true });
    await users.insert({ meta: { a: 1, b: 2 } });
    await expect(users.insert({ meta: { b: 2, a: 1 } })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('indexes boolean values distinctly', async () => {
    await users.ensureIndex({ active: 1 }, { unique: true });
    await users.insert({ active: true });
    await users.insert({ active: false }); // distinct from true
    await expect(users.insert({ active: true })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('enforces a compound unique index that includes a dot-path field', async () => {
    await users.ensureIndex({ 'profile.team': 1, seat: 1 }, { unique: true });
    await users.insert({ profile: { team: 'a' }, seat: 1 });
    await users.insert({ profile: { team: 'a' }, seat: 2 }); // same team, other seat
    await users.insert({ profile: { team: 'b' }, seat: 1 }); // other team, same seat
    await expect(
      users.insert({ profile: { team: 'a' }, seat: 1 }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('leaves the collection size unchanged after a rejected duplicate insert', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.insert({ email: 'a@x.com' });
    const before = users.size;
    await expect(users.insert({ email: 'a@x.com' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
    expect(users.size).toBe(before);
  });

  it('treats compound indexes with different field order as distinct', async () => {
    await users.ensureIndex({ a: 1, b: 1 }, { unique: true });
    await users.ensureIndex({ b: 1, a: 1 }, { unique: true });
    expect(users.listIndexes()).toHaveLength(2);
  });

  it('produces a stable key for out-of-domain nested values (undefined)', async () => {
    await users.ensureIndex({ meta: 1 }, { unique: true });
    await users.insert({ _id: 'a', meta: { x: undefined } });
    await expect(
      users.insert({ _id: 'b', meta: { x: undefined } }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('indexes Date values by instant', async () => {
    await users.ensureIndex({ at: 1 }, { unique: true });
    await users.insert({ at: new Date('2024-01-01T00:00:00.000Z') });
    await users.insert({ at: new Date('2024-02-01T00:00:00.000Z') }); // distinct
    await expect(
      users.insert({ at: new Date('2024-01-01T00:00:00.000Z') }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('indexes array values by element and order', async () => {
    await users.ensureIndex({ tags: 1 }, { unique: true });
    await users.insert({ tags: ['a', 'b'] });
    await users.insert({ tags: ['b', 'a'] }); // different order → distinct
    await expect(users.insert({ tags: ['a', 'b'] })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });

  it('deletes cleanly on a collection that has only a non-unique index', async () => {
    await users.ensureIndex({ city: 1 }); // non-unique → no key map to maintain
    await users.insert({ _id: 'x', city: 'NYC' });
    expect(await users.delete('x')).toBe(true);
    expect(users.size).toBe(0);
  });

  it('returns defensive copies from listIndexes', async () => {
    await users.ensureIndex({ a: 1, b: -1 });
    const first = users.listIndexes();
    (first[0]!.fields as string[]).push('zzz');
    (first[0]!.spec as Record<string, number>).a = 999;
    // A later call is unaffected by mutating an earlier result.
    const second = users.listIndexes();
    expect(second[0]!.fields).toEqual(['a', 'b']);
    expect(second[0]!.spec).toEqual({ a: 1, b: -1 });
  });
});
