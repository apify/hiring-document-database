import { describe, expect, it } from 'vitest';

import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  Database,
  DatabaseError,
  DuplicateKeyError,
  ImmutableFieldError,
  InvalidUpdateError,
  inc,
} from '../src/index.js';

describe('error classes', () => {
  it('every error sets .name to its own class name', () => {
    expect(new DatabaseError('m').name).toBe('DatabaseError');
    expect(new CollectionNotFoundError('x').name).toBe('CollectionNotFoundError');
    expect(new CollectionAlreadyExistsError('x').name).toBe(
      'CollectionAlreadyExistsError',
    );
    expect(new DuplicateKeyError(['_id'], ['x']).name).toBe('DuplicateKeyError');
    expect(new ImmutableFieldError('_id').name).toBe('ImmutableFieldError');
    expect(new InvalidUpdateError('a', 'why').name).toBe('InvalidUpdateError');
  });

  it('all errors are instances of DatabaseError and Error', () => {
    const errors = [
      new CollectionNotFoundError('x'),
      new CollectionAlreadyExistsError('x'),
      new DuplicateKeyError(['_id'], ['x']),
      new ImmutableFieldError('_id'),
      new InvalidUpdateError('a', 'why'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('CollectionNotFoundError carries the collection name', () => {
    expect(new CollectionNotFoundError('users').collectionName).toBe('users');
  });

  it('DuplicateKeyError carries fields and value, and mentions both in the message', () => {
    const error = new DuplicateKeyError(['email'], ['a@x.com']);
    expect(error.fields).toEqual(['email']);
    expect(error.value).toEqual(['a@x.com']);
    expect(error.message).toContain('email');
    expect(error.message).toContain('a@x.com');
  });

  it('a duplicate _id throws a DuplicateKeyError with an array value', async () => {
    const users = await new Database().newCollection('users');
    await users.insert({ _id: 'u1' });
    await expect(users.insert({ _id: 'u1' })).rejects.toMatchObject({
      name: 'DuplicateKeyError',
      fields: ['_id'],
      value: ['u1'],
    });
  });

  it('ImmutableFieldError from update carries the field', async () => {
    const users = await new Database().newCollection('users');
    await users.insert({ _id: 'u1' });
    await expect(users.update({ _id: 'u1' }, { _id: 'x' })).rejects.toMatchObject({
      name: 'ImmutableFieldError',
      field: '_id',
    });
  });

  it('InvalidUpdateError from a bad increment carries the field', async () => {
    const users = await new Database().newCollection('users');
    await users.insert({ _id: 'u1', name: 'Ada' });
    await expect(
      users.update({ _id: 'u1' }, { name: inc(1) }),
    ).rejects.toMatchObject({ name: 'InvalidUpdateError', field: 'name' });
  });
});
