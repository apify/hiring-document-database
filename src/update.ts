import { ImdbError } from './errors.js';
import { getPath, setPath, unsetPath } from './path.js';
import type { Document, UpdateChanges } from './types.js';

/**
 * An update operation produced by one of the update helpers (`inc`, `dec`,
 * `unset`). Callers never build these by hand. A plain value in an update means
 * "set this field".
 */
export interface UpdateOperator {
  readonly __imdbUpdate: true;
  readonly op: 'inc' | 'unset';
  readonly amount?: number;
}

/** Increments a numeric field by `amount` (default 1). Missing fields start at 0. */
export const inc = (amount = 1): UpdateOperator => ({
  __imdbUpdate: true,
  op: 'inc',
  amount,
});

/** Decrements a numeric field by `amount` (default 1). Missing fields start at 0. */
export const dec = (amount = 1): UpdateOperator => ({
  __imdbUpdate: true,
  op: 'inc',
  amount: -amount,
});

/** Removes a field from the document. */
export const unset = (): UpdateOperator => ({ __imdbUpdate: true, op: 'unset' });

/** Type guard: is this update value an operator rather than a plain set value? */
export function isUpdateOperator(value: unknown): value is UpdateOperator {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __imdbUpdate?: unknown }).__imdbUpdate === true
  );
}

/**
 * Applies `changes` to `doc` in place. Field names may use dot-paths to address
 * nested properties. A plain value sets the field (creating nested objects as
 * needed); `inc`/`dec` adjust a numeric field (defaulting a missing field to 0);
 * `unset` removes it.
 *
 * @throws {ImdbError} when incrementing a non-numeric field, or setting a path
 *   through a non-object value.
 */
export function applyChanges(doc: Document, changes: UpdateChanges): void {
  const target = doc as Record<string, unknown>;
  for (const [field, change] of Object.entries(changes)) {
    if (!isUpdateOperator(change)) {
      setPath(target, field, structuredClone(change));
      continue;
    }

    if (change.op === 'unset') {
      unsetPath(target, field);
      continue;
    }

    // op === 'inc' (dec is inc with a negated amount)
    const current = getPath(doc, field);
    const base = current === undefined ? 0 : current;
    if (typeof base !== 'number') {
      throw new ImdbError(
        `Cannot increment field "${field}": current value is not a number.`,
      );
    }
    setPath(target, field, base + (change.amount ?? 0));
  }
}
