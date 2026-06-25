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

  it('updates every document when the filter is empty', async () => {
    const modified = await users.update({}, { active: false });
    expect(modified).toBe(3);
  });

  it('overwrites an existing field value', async () => {
    await users.update({ _id: '1' }, { age: 100 });
    expect((await users.get('1'))?.age).toBe(100);
  });

  it('applies several field changes at once', async () => {
    await users.update({ _id: '1' }, { age: 40, active: false, city: 'London' });
    const ada = await users.get('1');
    expect(ada).toMatchObject({ age: 40, active: false, city: 'London' });
  });

  it('deep-copies the new value — later mutation does not leak into storage', async () => {
    const tags = ['x'];
    await users.update({ _id: '1' }, { tags });
    tags.push('y');
    expect((await users.get('1'))?.tags).toEqual(['x']);
  });

  it('rejects an update that would collide two updated documents on a unique index', async () => {
    // Start from distinct, valid index keys so the index can be created.
    await users.update({ _id: '1' }, { team: 'red' });
    await users.update({ _id: '2' }, { team: 'blue' });
    await users.ensureIndex({ team: 1 }, { unique: true });
    // Collapsing both 'active' docs onto the same team collides within the batch.
    await expect(
      users.update({ active: true }, { team: 'shared' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    // Atomic: neither document changed.
    expect((await users.get('1'))?.team).toBe('red');
    expect((await users.get('2'))?.team).toBe('blue');
  });

  it('allows an update that keeps a unique index satisfied', async () => {
    await users.ensureIndex({ name: 1 }, { unique: true });
    const modified = await users.update({ _id: '1' }, { name: 'Lovelace' });
    expect(modified).toBe(1);
    expect((await users.get('1'))?.name).toBe('Lovelace');
  });
});
