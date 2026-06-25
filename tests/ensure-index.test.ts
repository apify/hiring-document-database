import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  DuplicateKeyError,
  ImdbError,
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

  it('is idempotent for an identical spec and options', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.ensureIndex({ email: 1 }, { unique: true });
    expect(users.listIndexes()).toHaveLength(1);
  });

  it('throws when the same fields are re-indexed with conflicting options', async () => {
    await users.ensureIndex({ email: 1 });
    await expect(
      users.ensureIndex({ email: 1 }, { unique: true }),
    ).rejects.toBeInstanceOf(ImdbError);
  });

  it('rejects an empty spec', async () => {
    await expect(users.ensureIndex({})).rejects.toBeInstanceOf(ImdbError);
  });

  it('rejects an invalid direction', async () => {
    await expect(
      // @ts-expect-error - 2 is not a valid SortDirection
      users.ensureIndex({ email: 2 }),
    ).rejects.toBeInstanceOf(ImdbError);
  });

  it('treats a missing indexed field as a single null key (collides)', async () => {
    await users.ensureIndex({ email: 1 }, { unique: true });
    await users.insert({ name: 'no-email-1' });
    await expect(users.insert({ name: 'no-email-2' })).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
  });
});
