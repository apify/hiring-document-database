import { getPath } from './path.js';
import type {
  ComparisonOperator,
  Document,
  FieldMatcher,
  Filter,
} from './types.js';

function makeMatcher(op: ComparisonOperator, value: unknown): FieldMatcher {
  return { __matcher: true, op, value };
}

/**
 * Filter helpers. The query language is equality-by-default: a bare value in a
 * filter means "equals". For ordered comparisons, wrap the value in a helper:
 *
 * ```ts
 * collection.list({ age: gt(18), country: 'CZ' });
 * ```
 */
export const eq = (value: unknown): FieldMatcher => makeMatcher('eq', value);
export const ne = (value: unknown): FieldMatcher => makeMatcher('ne', value);
export const gt = (value: unknown): FieldMatcher => makeMatcher('gt', value);
export const gte = (value: unknown): FieldMatcher => makeMatcher('gte', value);
export const lt = (value: unknown): FieldMatcher => makeMatcher('lt', value);
export const lte = (value: unknown): FieldMatcher => makeMatcher('lte', value);

/** Type guard: is this filter value a comparison helper rather than a raw value? */
export function isMatcher(value: unknown): value is FieldMatcher {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __matcher?: unknown }).__matcher === true
  );
}

/**
 * Structural equality for JSON-like values. Handles primitives (including
 * `NaN`), `Date`, arrays and plain objects (key order independent).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/**
 * Orders two values of a comparable, like-typed pair (number/number,
 * string/string, Date/Date). Returns a negative number, zero or a positive
 * number — or `null` when the values are not order-comparable (different types,
 * objects, etc.), in which case ordered operators never match.
 */
function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  return null;
}

function matchesCondition(fieldValue: unknown, matcher: FieldMatcher): boolean {
  switch (matcher.op) {
    case 'eq':
      return deepEqual(fieldValue, matcher.value);
    case 'ne':
      return !deepEqual(fieldValue, matcher.value);
    case 'gt': {
      const c = compare(fieldValue, matcher.value);
      return c !== null && c > 0;
    }
    case 'gte': {
      const c = compare(fieldValue, matcher.value);
      return c !== null && c >= 0;
    }
    case 'lt': {
      const c = compare(fieldValue, matcher.value);
      return c !== null && c < 0;
    }
    case 'lte': {
      const c = compare(fieldValue, matcher.value);
      return c !== null && c <= 0;
    }
    default:
      return false;
  }
}

/**
 * Returns true when `doc` satisfies every entry in `filter`. An empty filter
 * matches all documents. Field names may use dot-paths (e.g. `"address.city"`)
 * to address nested properties.
 */
export function matchesFilter(doc: Document, filter: Filter): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    const fieldValue = getPath(doc, field);
    const ok = isMatcher(condition)
      ? matchesCondition(fieldValue, condition)
      : deepEqual(fieldValue, condition);
    if (!ok) return false;
  }
  return true;
}
