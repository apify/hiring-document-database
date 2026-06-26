/** Base class for every error thrown by this library. */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown by `Database.newCollection` when the name is already in use. */
export class CollectionAlreadyExistsError extends DatabaseError {
  constructor(public readonly collectionName: string) {
    super(`Collection "${collectionName}" already exists.`);
  }
}

/** Thrown when an operation targets a collection that does not exist. */
export class CollectionNotFoundError extends DatabaseError {
  constructor(public readonly collectionName: string) {
    super(`Collection "${collectionName}" does not exist.`);
  }
}

/**
 * Thrown when a write would violate uniqueness — either a duplicate `_id` or a
 * collision on a `{ unique: true }` index.
 *
 * `value` is always the array of offending field values, in the same order as
 * `fields` (a single-element array for a duplicate `_id`).
 */
export class DuplicateKeyError extends DatabaseError {
  constructor(
    public readonly fields: readonly string[],
    public readonly value: readonly unknown[],
  ) {
    super(
      `Duplicate key error on { ${fields.join(', ')} }: ${JSON.stringify(value)}`,
    );
  }
}

/** Thrown when an update attempts to change an immutable field (`_id`). */
export class ImmutableFieldError extends DatabaseError {
  constructor(public readonly field: string) {
    super(`Field "${field}" is immutable and cannot be updated.`);
  }
}

/**
 * Thrown when an update operation is invalid — incrementing a non-numeric
 * field, or setting a dot-path through a value that is not an object.
 */
export class InvalidUpdateError extends DatabaseError {
  constructor(
    public readonly field: string,
    reason: string,
  ) {
    super(`Invalid update on field "${field}": ${reason}.`);
  }
}
