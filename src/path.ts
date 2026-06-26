import { ImdbError } from './errors.js';

/**
 * Dot-path access for nested document fields. A path like `"a.b"` refers to key
 * `b` inside the object stored under key `a`. Only plain objects are traversed;
 * arrays and primitives terminate a path.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the value at `path`. Returns `undefined` when any segment along the way
 * is missing or not a traversable object. Never throws.
 */
export function getPath(root: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Sets `value` at `path`, creating intermediate objects for missing segments.
 *
 * @throws {ImdbError} when an existing intermediate segment is not a plain
 *   object (e.g. setting `"a.b"` where `a` is a number or array).
 */
export function setPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const next = current[segment];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
    } else if (isPlainObject(next)) {
      current = next;
    } else {
      const traversed = segments.slice(0, i + 1).join('.');
      throw new ImdbError(
        `Cannot set path "${path}": "${traversed}" is not an object.`,
      );
    }
  }
  current[segments[segments.length - 1]!] = value;
}

/**
 * Removes the value at `path`. A no-op when the path does not exist.
 */
export function unsetPath(root: Record<string, unknown>, path: string): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = current[segments[i]!];
    if (!isPlainObject(next)) return; // path doesn't exist — nothing to remove
    current = next;
  }
  delete current[segments[segments.length - 1]!];
}
