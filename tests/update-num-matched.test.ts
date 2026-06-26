import { beforeEach, describe, expect, it } from 'vitest';

import {
  Collection,
  Database,
  DuplicateKeyError,
  ImmutableFieldError,
  InvalidUpdateError,
  gt,
  gte,
  inc,
  lt,
  unset,
} from '../src/index.js';

/**
 * Focused, comprehensive coverage of `update`'s return contract: it resolves to
 * an `UpdateResult` object whose single `numMatched` field is the number of
 * documents matched by the filter (and therefore updated). These tests pin down
 * both the *shape* of the result and the *count* across a wide range of filters.
 */
describe('update → { numMatched }', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
    await users.insert({ _id: '1', name: 'Ada', age: 36, active: true });
    await users.insert({ _id: '2', name: 'Babbage', age: 49, active: true });
    await users.insert({ _id: '3', name: 'Turing', age: 41, active: false });
    await users.insert({ _id: '4', name: 'Hopper', age: 36, active: true });
  });

  describe('result shape', () => {
    it('resolves to an object, not a bare number', async () => {
      const result = await users.update({ _id: '1' }, { age: 37 });
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
      expect(typeof result.numMatched).toBe('number');
    });

    it('exposes exactly one field, numMatched', async () => {
      const result = await users.update({ active: true }, { active: false });
      expect(Object.keys(result)).toEqual(['numMatched']);
    });

    it('is plain JSON-serializable with the expected payload', async () => {
      const result = await users.update({ active: true }, { seen: true });
      expect(JSON.parse(JSON.stringify(result))).toEqual({ numMatched: 3 });
    });

    it('returns numMatched as a non-negative integer', async () => {
      const { numMatched } = await users.update({ age: gt(40) }, { senior: true });
      expect(Number.isInteger(numMatched)).toBe(true);
      expect(numMatched).toBeGreaterThanOrEqual(0);
    });
  });

  describe('counts matches by the filter', () => {
    it('counts a single match for an _id filter', async () => {
      expect(await users.update({ _id: '2' }, { vip: true })).toEqual({
        numMatched: 1,
      });
    });

    it('counts multiple matches for an equality filter', async () => {
      expect(await users.update({ active: true }, { vip: true })).toEqual({
        numMatched: 3,
      });
    });

    it('counts matches for a value shared by several documents', async () => {
      // Two users are aged 36.
      expect(await users.update({ age: 36 }, { cohort: '36' })).toEqual({
        numMatched: 2,
      });
    });

    it('counts every document for an empty filter', async () => {
      expect(await users.update({}, { touched: true })).toEqual({
        numMatched: 4,
      });
    });

    it('counts matches for a gt comparison filter', async () => {
      expect(await users.update({ age: gt(40) }, { senior: true })).toEqual({
        numMatched: 2,
      });
    });

    it('counts matches for a gte comparison filter', async () => {
      expect(await users.update({ age: gte(41) }, { senior: true })).toEqual({
        numMatched: 2,
      });
    });

    it('counts matches for an lt comparison filter', async () => {
      expect(await users.update({ age: lt(41) }, { junior: true })).toEqual({
        numMatched: 2,
      });
    });

    it('counts matches for a compound (AND-ed) filter', async () => {
      expect(
        await users.update({ active: true, age: 36 }, { tag: 'x' }),
      ).toEqual({ numMatched: 2 });
    });

    it('returns numMatched 0 when nothing matches', async () => {
      expect(await users.update({ name: 'Nobody' }, { active: false })).toEqual({
        numMatched: 0,
      });
    });

    it('returns numMatched 0 for a compound filter that excludes everything', async () => {
      expect(
        await users.update({ active: false, age: 36 }, { tag: 'x' }),
      ).toEqual({ numMatched: 0 });
    });
  });

  describe('counts matches independently of what changed', () => {
    it('counts a match even when changes is empty (no-op)', async () => {
      expect(await users.update({ active: true }, {})).toEqual({
        numMatched: 3,
      });
    });

    it('counts a match when the set value equals the current value', async () => {
      // Ada is already aged 36; the value does not change but she still matched.
      expect(await users.update({ _id: '1' }, { age: 36 })).toEqual({
        numMatched: 1,
      });
    });

    it('counts a match when an unset targets a missing path (no-op)', async () => {
      expect(await users.update({ _id: '1' }, { 'nope.gone': unset() })).toEqual({
        numMatched: 1,
      });
    });

    it('does not vary with the number of fields changed', async () => {
      const one = await users.update({ _id: '1' }, { a: 1 });
      const many = await users.update({ _id: '2' }, { a: 1, b: 2, c: 3, d: 4 });
      expect(one).toEqual({ numMatched: 1 });
      expect(many).toEqual({ numMatched: 1 });
    });
  });

  describe('reflects the collection state at update time', () => {
    it('counts a freshly inserted document on the next update', async () => {
      await users.insert({ _id: '5', name: 'Lovelace', age: 28, active: true });
      expect(await users.update({ active: true }, { vip: true })).toEqual({
        numMatched: 4,
      });
    });

    it('does not count a document removed before the update', async () => {
      await users.delete('1');
      expect(await users.update({ active: true }, { vip: true })).toEqual({
        numMatched: 2,
      });
    });

    it('counts documents matched by a field added in an earlier update', async () => {
      await users.update({ age: gt(40) }, { senior: true });
      expect(await users.update({ senior: true }, { reviewed: true })).toEqual({
        numMatched: 2,
      });
    });
  });

  describe('counting on larger collections', () => {
    it('counts all matches across many documents', async () => {
      const big = await new Database().newCollection('big');
      for (let i = 0; i < 1_000; i++) {
        await big.insert({ _id: String(i), even: i % 2 === 0 });
      }
      expect(await big.update({ even: true }, { marked: true })).toEqual({
        numMatched: 500,
      });
      expect(await big.update({}, { touched: true })).toEqual({
        numMatched: 1_000,
      });
    });
  });

  describe('no result is produced when the update is rejected', () => {
    it('throws (returns nothing) on an attempt to change _id', async () => {
      await expect(
        users.update({ active: true }, { _id: 'x' }),
      ).rejects.toBeInstanceOf(ImmutableFieldError);
    });

    it('throws (returns nothing) on a unique-index violation', async () => {
      await users.ensureIndex({ name: 1 }, { unique: true });
      await expect(
        users.update({ _id: '3' }, { name: 'Ada' }),
      ).rejects.toBeInstanceOf(DuplicateKeyError);
    });

    it('throws (returns nothing) on an invalid operator update', async () => {
      await expect(
        users.update({ _id: '1' }, { name: inc(1) }),
      ).rejects.toBeInstanceOf(InvalidUpdateError);
    });
  });
});
