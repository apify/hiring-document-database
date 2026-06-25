import { describe, expect, it } from 'vitest';

import {
  deepEqual,
  eq,
  gt,
  gte,
  isMatcher,
  lt,
  lte,
  matchesFilter,
  ne,
} from '../src/index.js';
import type { Document } from '../src/index.js';

const doc = (fields: Record<string, unknown>): Document =>
  ({ _id: 'x', ...fields }) as Document;

describe('isMatcher', () => {
  it('recognises helper-produced matchers', () => {
    expect(isMatcher(gt(1))).toBe(true);
    expect(isMatcher(eq('a'))).toBe(true);
  });

  it('rejects plain values and look-alikes', () => {
    expect(isMatcher(1)).toBe(false);
    expect(isMatcher('a')).toBe(false);
    expect(isMatcher(null)).toBe(false);
    expect(isMatcher(undefined)).toBe(false);
    expect(isMatcher({ op: 'gt', value: 1 })).toBe(false);
    expect(isMatcher([1, 2])).toBe(false);
  });
});

describe('deepEqual', () => {
  it('compares primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(true, false)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(0, false)).toBe(false);
    expect(deepEqual('', false)).toBe(false);
  });

  it('treats NaN as equal to NaN', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(NaN, 1)).toBe(false);
  });

  it('compares dates by instant', () => {
    expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-01'))).toBe(true);
    expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-02'))).toBe(false);
    expect(deepEqual(new Date('2024-01-01'), '2024-01-01')).toBe(false);
  });

  it('compares arrays by element and order', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('compares objects regardless of key order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(true);
    expect(deepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('matches everything for an empty filter', () => {
    expect(matchesFilter(doc({ a: 1 }), {})).toBe(true);
  });

  it('matches a bare value by equality', () => {
    expect(matchesFilter(doc({ a: 1 }), { a: 1 })).toBe(true);
    expect(matchesFilter(doc({ a: 1 }), { a: 2 })).toBe(false);
  });

  it('matches null and falsy values explicitly', () => {
    expect(matchesFilter(doc({ a: null }), { a: null })).toBe(true);
    expect(matchesFilter(doc({ a: 0 }), { a: 0 })).toBe(true);
    expect(matchesFilter(doc({ a: false }), { a: false })).toBe(true);
    expect(matchesFilter(doc({ a: '' }), { a: '' })).toBe(true);
  });

  it('does not match a present field against a different value', () => {
    expect(matchesFilter(doc({ a: 1 }), { a: undefined })).toBe(false);
  });

  it('treats a missing field as undefined', () => {
    expect(matchesFilter(doc({ a: 1 }), { missing: undefined })).toBe(true);
    expect(matchesFilter(doc({ a: 1 }), { missing: 5 })).toBe(false);
    expect(matchesFilter(doc({ a: 1 }), { missing: ne(5) })).toBe(true);
    expect(matchesFilter(doc({ a: 1 }), { missing: gt(5) })).toBe(false);
  });

  it('ANDs all keys', () => {
    expect(matchesFilter(doc({ a: 1, b: 2 }), { a: 1, b: 2 })).toBe(true);
    expect(matchesFilter(doc({ a: 1, b: 2 }), { a: 1, b: 99 })).toBe(false);
  });

  it('applies ne', () => {
    expect(matchesFilter(doc({ a: 1 }), { a: ne(2) })).toBe(true);
    expect(matchesFilter(doc({ a: 1 }), { a: ne(1) })).toBe(false);
  });

  describe('ordered comparisons', () => {
    it('work on numbers', () => {
      expect(matchesFilter(doc({ a: 5 }), { a: gt(4) })).toBe(true);
      expect(matchesFilter(doc({ a: 5 }), { a: gt(5) })).toBe(false);
      expect(matchesFilter(doc({ a: 5 }), { a: gte(5) })).toBe(true);
      expect(matchesFilter(doc({ a: 5 }), { a: lt(6) })).toBe(true);
      expect(matchesFilter(doc({ a: 5 }), { a: lte(5) })).toBe(true);
      expect(matchesFilter(doc({ a: 5 }), { a: lt(5) })).toBe(false);
    });

    it('work on strings (lexicographic)', () => {
      expect(matchesFilter(doc({ a: 'banana' }), { a: gt('apple') })).toBe(true);
      expect(matchesFilter(doc({ a: 'apple' }), { a: lt('banana') })).toBe(true);
      expect(matchesFilter(doc({ a: 'm' }), { a: gte('m') })).toBe(true);
    });

    it('work on dates', () => {
      const d = doc({ a: new Date('2024-06-01') });
      expect(matchesFilter(d, { a: gt(new Date('2024-01-01')) })).toBe(true);
      expect(matchesFilter(d, { a: lt(new Date('2024-01-01')) })).toBe(false);
    });

    it('never match across non-comparable types', () => {
      expect(matchesFilter(doc({ a: 5 }), { a: gt('x') })).toBe(false);
      expect(matchesFilter(doc({ a: 'x' }), { a: lt(5) })).toBe(false);
      expect(matchesFilter(doc({ a: {} }), { a: gt(5) })).toBe(false);
      expect(matchesFilter(doc({ a: null }), { a: gt(5) })).toBe(false);
    });
  });
});
