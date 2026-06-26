import { InvalidUpdateError } from './errors.js';

/**
 * Dot-path access for nested document fields. A path like `"a.b"` refers to key
 * `b` inside the object stored under key `a`. Only plain objects are traversed,
 * and only via *own* properties — inherited members (`toString`, `constructor`,
 * `__proto__`, …) are never read or written, which keeps reads honest and makes
 * writes safe against prototype pollution.
 */

const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Reads the value at `path`. Returns `undefined` when any segment along the way
 * is missing, inherited, or not a traversable plain object. Never throws.
 */
export function getPath(root: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(current) || !hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Sets `value` at `path`, creating intermediate objects for missing segments.
 *
 * @throws {InvalidUpdateError} when a segment is an unsafe key
 *   (`__proto__` / `prototype` / `constructor`), or when an existing
 *   intermediate segment is not a plain object.
 */
export function setPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.');
  if (segments.some((segment) => UNSAFE_SEGMENTS.has(segment))) {
    throw new InvalidUpdateError(path, 'path contains an unsafe key');
  }

  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    if (hasOwn(current, segment)) {
      const next = current[segment];
      if (!isPlainObject(next)) {
        const traversed = segments.slice(0, i + 1).join('.');
        throw new InvalidUpdateError(path, `"${traversed}" is not an object`);
      }
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
    }
  }
  current[segments[segments.length - 1]!] = value;
}

/**
 * Removes the value at `path`. A no-op when the path does not exist or contains
 * an unsafe key.
 */
export function unsetPath(root: Record<string, unknown>, path: string): void {
  const segments = path.split('.');
  if (segments.some((segment) => UNSAFE_SEGMENTS.has(segment))) return;

  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    if (!hasOwn(current, segment) || !isPlainObject(current[segment])) return;
    current = current[segment] as Record<string, unknown>;
  }
  delete current[segments[segments.length - 1]!];
}
