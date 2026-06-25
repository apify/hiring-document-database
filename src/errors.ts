/** Base class for every error thrown by this library. */
export class ImdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown by `Database.newCollection` when the name is already in use. */
export class CollectionAlreadyExistsError extends ImdbError {
  constructor(public readonly collectionName: string) {
    super(`Collection "${collectionName}" already exists.`);
  }
}

/** Thrown when an operation targets a collection that does not exist. */
export class CollectionNotFoundError extends ImdbError {
  constructor(public readonly collectionName: string) {
    super(`Collection "${collectionName}" does not exist.`);
  }
}

/**
 * Thrown when a write would violate uniqueness — either a duplicate `_id` or a
 * collision on a `{ unique: true }` index.
 */
export class DuplicateKeyError extends ImdbError {
  constructor(
    public readonly fields: readonly string[],
    public readonly value: unknown,
  ) {
    super(
      `Duplicate key error on { ${fields.join(', ')} }: ${JSON.stringify(value)}`,
    );
  }
}

/** Thrown when an update attempts to change an immutable field (`_id`). */
export class ImmutableFieldError extends ImdbError {
  constructor(public readonly field: string) {
    super(`Field "${field}" is immutable and cannot be updated.`);
  }
}
