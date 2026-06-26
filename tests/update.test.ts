import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  DuplicateKeyError,
  ImmutableFieldError,
  InvalidUpdateError,
  gt,
  inc,
} from '../src/index.js';

describe('update', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
    await users.insert({ _id: '1', name: 'Ada', age: 36, active: true });
    await users.insert({ _id: '2', name: 'Babbage', age: 49, active: true });
    await users.insert({ _id: '3', name: 'Turing', age: 41, active: false });
  });

  it('updates every document matching the filter and returns numMatched', async () => {
    const result = await users.update({ active: true }, { active: false });
    expect(result).toEqual({ numMatched: 2 });
    expect((await users.get('1'))?.active).toBe(false);
    expect((await users.get('2'))?.active).toBe(false);
    expect((await users.get('3'))?.active).toBe(false);
  });

  it('works with comparison filters', async () => {
    const result = await users.update({ age: gt(40) }, { senior: true });
    expect(result).toEqual({ numMatched: 2 });
    expect((await users.get('1'))?.senior).toBeUndefined();
    expect((await users.get('2'))?.senior).toBe(true);
  });

  it('adds fields that did not previously exist', async () => {
    await users.update({ _id: '1' }, { nickname: 'Countess' });
    expect((await users.get('1'))?.nickname).toBe('Countess');
  });

  it('returns numMatched 0 and changes nothing when nothing matches', async () => {
    const result = await users.update({ name: 'Nobody' }, { active: false });
    expect(result).toEqual({ numMatched: 0 });
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
    const result = await users.update({}, { active: false });
    expect(result).toEqual({ numMatched: 3 });
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
    const result = await users.update({ _id: '1' }, { name: 'Lovelace' });
    expect(result).toEqual({ numMatched: 1 });
    expect((await users.get('1'))?.name).toBe('Lovelace');
  });

  it('preserves a Date set value as a real Date', async () => {
    await users.update({ _id: '1' }, { joinedAt: new Date('2024-01-02T03:04:05.000Z') });
    const stored = await users.get('1');
    expect(stored?.joinedAt).toBeInstanceOf(Date);
    expect((stored?.joinedAt as Date).toISOString()).toBe(
      '2024-01-02T03:04:05.000Z',
    );
  });

  it('deep-copies a nested-object set value', async () => {
    const meta = { a: { b: 1 } };
    await users.update({ _id: '1' }, { meta });
    meta.a.b = 999;
    expect((await users.get('1'))?.meta).toEqual({ a: { b: 1 } });
  });

  it('leaves the collection size unchanged after a rejected unique update', async () => {
    await users.ensureIndex({ name: 1 }, { unique: true });
    const before = users.size;
    await expect(
      users.update({ _id: '3' }, { name: 'Ada' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    expect(users.size).toBe(before);
  });

  it('is atomic when an operator fails on a later matched document', async () => {
    const c = await new Database().newCollection('c');
    await c.insert({ _id: 'a', score: 1 });
    await c.insert({ _id: 'b', score: 'high' }); // non-numeric
    await expect(c.update({}, { score: inc(1) })).rejects.toBeInstanceOf(
      InvalidUpdateError,
    );
    // Neither document changed — not even the one processed before the failure.
    expect((await c.get('a'))?.score).toBe(1);
    expect((await c.get('b'))?.score).toBe('high');
  });

  it('treats an empty changes object as a no-op that still counts matches', async () => {
    const result = await users.update({ active: true }, {});
    expect(result).toEqual({ numMatched: 2 });
    expect((await users.get('1'))?.age).toBe(36); // unchanged
  });

  it('updates normally when a non-unique index is present', async () => {
    await users.ensureIndex({ active: 1 }); // non-unique → not enforced
    const result = await users.update({ active: true }, { active: false });
    expect(result).toEqual({ numMatched: 2 });
    expect((await users.get('1'))?.active).toBe(false);
    expect((await users.get('2'))?.active).toBe(false);
  });
});
