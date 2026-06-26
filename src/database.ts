import { Collection } from './collection.js';
import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
} from './errors.js';
import type { DatabaseInit } from './types.js';

/**
 * Top-level handle to the database: a named set of collections.
 */
export class Database {
  private readonly collections = new Map<string, Collection>();

  /**
   * Creates a database, optionally pre-populated with collections.
   *
   * ```ts
   * const db = new Database({
   *   users: [{ _id: 'u1', name: 'Ada' }],
   *   orders: [], // empty collection
   * });
   * ```
   *
   * @param initial Mapping from collection name to its starting documents.
   * @throws {DuplicateKeyError} if a collection's seed documents contain a
   *   duplicate `_id`.
   */
  constructor(initial: DatabaseInit = {}) {
    for (const [name, documents] of Object.entries(initial)) {
      this.collections.set(name, new Collection(name, documents));
    }
  }

  /**
   * Creates a new, empty collection and returns it.
   *
   * @throws {CollectionAlreadyExistsError} if the name is already taken.
   */
  async newCollection(name: string): Promise<Collection> {
    if (this.collections.has(name)) {
      throw new CollectionAlreadyExistsError(name);
    }
    const collection = new Collection(name);
    this.collections.set(name, collection);
    return collection;
  }

  /**
   * Drops a collection and all of its documents.
   *
   * @throws {CollectionNotFoundError} if no such collection exists.
   */
  async removeCollection(name: string): Promise<void> {
    if (!this.collections.delete(name)) {
      throw new CollectionNotFoundError(name);
    }
  }

  /**
   * Returns an existing collection handle.
   *
   * @throws {CollectionNotFoundError} if no such collection exists.
   */
  collection(name: string): Collection {
    const collection = this.collections.get(name);
    if (!collection) {
      throw new CollectionNotFoundError(name);
    }
    return collection;
  }

  /** Whether a collection with the given name exists. */
  hasCollection(name: string): boolean {
    return this.collections.has(name);
  }

  /** Names of all collections, in insertion order. */
  listCollections(): string[] {
    return [...this.collections.keys()];
  }
}
