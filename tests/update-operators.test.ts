import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  ImmutableFieldError,
  InvalidUpdateError,
  dec,
  inc,
  unset,
} from '../src/index.js';

describe('update operators', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
    await users.insert({
      _id: '1',
      name: 'Ada',
      visits: 5,
      profile: { score: 10, city: 'London' },
    });
  });

  describe('inc / dec', () => {
    it('increments an existing numeric field', async () => {
      await users.update({ _id: '1' }, { visits: inc(3) });
      expect((await users.get('1'))?.visits).toBe(8);
    });

    it('defaults a missing field to 0 before incrementing', async () => {
      await users.update({ _id: '1' }, { logins: inc(2) });
      expect((await users.get('1'))?.logins).toBe(2);
    });

    it('decrements (and defaults a missing field to 0)', async () => {
      await users.update({ _id: '1' }, { visits: dec(2) });
      expect((await users.get('1'))?.visits).toBe(3);
      await users.update({ _id: '1' }, { credits: dec(1) });
      expect((await users.get('1'))?.credits).toBe(-1);
    });

    it('defaults the step to 1', async () => {
      await users.update({ _id: '1' }, { visits: inc() });
      expect((await users.get('1'))?.visits).toBe(6);
    });

    it('increments a nested field via dot-path', async () => {
      await users.update({ _id: '1' }, { 'profile.score': inc(5) });
      expect((await users.get('1'))?.profile).toEqual({ score: 15, city: 'London' });
    });

    it('increments a missing nested field, creating the path', async () => {
      await users.update({ _id: '1' }, { 'counters.daily': inc(1) });
      expect((await users.get('1'))?.counters).toEqual({ daily: 1 });
    });

    it('rejects incrementing a non-numeric field, atomically', async () => {
      await expect(
        users.update({ _id: '1' }, { name: inc(1) }),
      ).rejects.toBeInstanceOf(InvalidUpdateError);
      expect((await users.get('1'))?.name).toBe('Ada');
    });

    it('dec() defaults the step to 1 on an existing field', async () => {
      await users.update({ _id: '1' }, { visits: dec() });
      expect((await users.get('1'))?.visits).toBe(4);
    });

    it('inc then dec composes to net zero on a fresh field', async () => {
      await users.update({ _id: '1' }, { points: inc(5) });
      await users.update({ _id: '1' }, { points: dec(5) });
      expect((await users.get('1'))?.points).toBe(0);
    });

    it('dec on a missing nested path creates it with a negative value', async () => {
      await users.update({ _id: '1' }, { 'scores.daily': dec(3) });
      expect((await users.get('1'))?.scores).toEqual({ daily: -3 });
    });
  });

  describe('unset', () => {
    it('removes a top-level field', async () => {
      await users.update({ _id: '1' }, { visits: unset() });
      const doc = await users.get('1');
      expect(doc).not.toHaveProperty('visits');
    });

    it('removes a nested field, preserving siblings', async () => {
      await users.update({ _id: '1' }, { 'profile.score': unset() });
      expect((await users.get('1'))?.profile).toEqual({ city: 'London' });
    });

    it('is a no-op for a missing path and still counts the document', async () => {
      const n = await users.update({ _id: '1' }, { 'nope.gone': unset() });
      expect(n).toBe(1);
      expect((await users.get('1'))?.profile).toEqual({ score: 10, city: 'London' });
    });
  });

  describe('set (plain value) with dot-paths', () => {
    it('sets a nested field, creating intermediate objects', async () => {
      await users.update({ _id: '1' }, { 'address.city': 'Paris' });
      expect((await users.get('1'))?.address).toEqual({ city: 'Paris' });
    });

    it('sets a nested field while preserving existing siblings', async () => {
      await users.update({ _id: '1' }, { 'profile.country': 'UK' });
      expect((await users.get('1'))?.profile).toEqual({
        score: 10,
        city: 'London',
        country: 'UK',
      });
    });

    it('rejects setting a path through a non-object value, atomically', async () => {
      await expect(
        users.update({ _id: '1' }, { 'name.first': 'Augusta' }),
      ).rejects.toBeInstanceOf(InvalidUpdateError);
      expect((await users.get('1'))?.name).toBe('Ada');
    });
  });

  it('applies a mix of set, inc and unset in one update', async () => {
    await users.update(
      { _id: '1' },
      { name: 'Lovelace', visits: inc(10), 'profile.city': unset() },
    );
    const doc = await users.get('1');
    expect(doc).toMatchObject({ name: 'Lovelace', visits: 15 });
    expect(doc?.profile).toEqual({ score: 10 });
  });

  it('refuses to mutate _id, including via a dot-path', async () => {
    await expect(
      users.update({ _id: '1' }, { _id: 'x' }),
    ).rejects.toBeInstanceOf(ImmutableFieldError);
    await expect(
      users.update({ _id: '1' }, { '_id.sub': 'x' }),
    ).rejects.toBeInstanceOf(ImmutableFieldError);
  });

  it('applies operators across every matching document', async () => {
    await users.insert({ _id: '2', visits: 100 });
    const n = await users.update({}, { visits: inc(1) });
    expect(n).toBe(2);
    expect((await users.get('1'))?.visits).toBe(6);
    expect((await users.get('2'))?.visits).toBe(101);
  });
});
