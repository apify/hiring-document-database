import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  DuplicateKeyError,
  ImmutableFieldError,
  gt,
} from '../src/index.js';

describe('update', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
    await users.insert({ _id: '1', name: 'Ada', age: 36, active: true });
    await users.insert({ _id: '2', name: 'Babbage', age: 49, active: true });
    await users.insert({ _id: '3', name: 'Turing', age: 41, active: false });
  });

  it('updates every document matching the filter and returns the count', async () => {
    const modified = await users.update({ active: true }, { active: false });
    expect(modified).toBe(2);
    expect((await users.get('1'))?.active).toBe(false);
    expect((await users.get('2'))?.active).toBe(false);
    expect((await users.get('3'))?.active).toBe(false);
  });

  it('works with comparison filters', async () => {
    const modified = await users.update({ age: gt(40) }, { senior: true });
    expect(modified).toBe(2);
    expect((await users.get('1'))?.senior).toBeUndefined();
    expect((await users.get('2'))?.senior).toBe(true);
  });

  it('adds fields that did not previously exist', async () => {
    await users.update({ _id: '1' }, { nickname: 'Countess' });
    expect((await users.get('1'))?.nickname).toBe('Countess');
  });

  it('returns 0 and changes nothing when nothing matches', async () => {
    const modified = await users.update({ name: 'Nobody' }, { active: false });
    expect(modified).toBe(0);
  });

  it('refuses to change the immutable _id', async () => {
    await expect(users.update({ _id: '1' }, { _id: 'x' })).rejects.toBeInstanceOf(
      ImmutableFieldError,
    );
  });

  it('rejects an update that would violate a unique index, atomically', async () => {
    await users.ensureIndex({ name: 1 }, { unique: true });
    // Renaming Turing -> Ada collides with the existing Ada.
    await expect(
      users.update({ _id: '3' }, { name: 'Ada' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    // Nothing was applied.
    expect((await users.get('3'))?.name).toBe('Turing');
  });
});
