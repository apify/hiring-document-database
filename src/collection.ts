import {
  DatabaseError,
  DuplicateKeyError,
  ImmutableFieldError,
} from './errors.js';
import { matchesFilter } from './filter.js';
import { generateId } from './id.js';
import { getPath } from './path.js';
import { applyChanges } from './update.js';
import type {
  Document,
  DocumentId,
  Filter,
  IndexDescription,
  IndexOptions,
  IndexSpec,
  InsertDocument,
  UpdateChanges,
} from './types.js';

interface IndexDefinition {
  readonly fields: string[];
  readonly spec: IndexSpec;
  readonly unique: boolean;
}

/** Deep copy used at every boundary so callers can never mutate stored state. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * A single collection: an unordered bag of schema-less documents keyed by `_id`.
 *
 * All mutating operations are atomic — they validate fully before touching
 * stored state, so a rejected write leaves the collection unchanged.
 *
 * Obtain a collection from a {@link Database} (`newCollection` / `collection`)
 * rather than constructing one directly.
 */
export class Collection {
  private readonly documents = new Map<DocumentId, Document>();
  private readonly indexes: IndexDefinition[] = [];

  /**
   * @param name        Collection name.
   * @param documents   Optional documents to seed the collection with. They are
   *                    inserted exactly as `insert` would (auto-generating any
   *                    missing `_id`), so a duplicate `_id` among them throws.
   */
  constructor(
    public readonly name: string,
    documents: readonly InsertDocument[] = [],
  ) {
    for (const document of documents) {
      this.insertOne(document);
    }
  }

  /** Number of documents currently stored. */
  get size(): number {
    return this.documents.size;
  }

  /**
   * Inserts a single document. When `_id` is omitted it is auto-generated.
   * Returns a copy of the stored document.
   *
   * @throws {DuplicateKeyError} on a duplicate `_id` or a unique-index collision.
   */
  async insert(input: InsertDocument): Promise<Document> {
    return clone(this.insertOne(input));
  }

  /** Synchronous insert core, shared by `insert` and constructor seeding. */
  private insertOne(input: InsertDocument): Document {
    const cloned = clone(input);
    const id = cloned._id ?? generateId();
    const doc: Document = { ...cloned, _id: id };

    if (this.documents.has(id)) {
      throw new DuplicateKeyError(['_id'], [id]);
    }
    this.assertUnique([...this.documents.values(), doc]);

    this.documents.set(id, doc);
    return doc;
  }

  /** Returns a copy of the document with the given id, or `null` if absent. */
  async get(id: DocumentId): Promise<Document | null> {
    const doc = this.documents.get(id);
    return doc ? clone(doc) : null;
  }

  /**
   * Returns an async iterator over copies of every document matching `filter`
   * (defaults to all). The matching set is snapshotted when `list` is called,
   * so writes made afterwards never disturb the iteration.
   */
  list(filter: Filter = {}): AsyncIterableIterator<Document> {
    const snapshot = [...this.documents.values()].filter((doc) =>
      matchesFilter(doc, filter),
    );
    let index = 0;
    const iterator: AsyncIterableIterator<Document> = {
      next: async (): Promise<IteratorResult<Document>> => {
        if (index < snapshot.length) {
          return { value: clone(snapshot[index++]!), done: false };
        }
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<Document> {
        return iterator;
      },
    };
    return iterator;
  }

  /**
   * Applies `changes` to every document matching `filter`. Fields that do not
   * exist yet are added. Returns the number of documents modified.
   *
   * @throws {ImmutableFieldError} when `changes` tries to alter `_id`.
   * @throws {DuplicateKeyError} when the result would violate a unique index
   *   (no changes are applied in that case).
   */
  async update(filter: Filter, changes: UpdateChanges): Promise<number> {
    for (const field of Object.keys(changes)) {
      if (field === '_id' || field.startsWith('_id.')) {
        throw new ImmutableFieldError('_id');
      }
    }

    const matches = [...this.documents.values()].filter((doc) =>
      matchesFilter(doc, filter),
    );
    if (matches.length === 0) return 0;

    // Build the proposed documents first; validate before committing anything.
    // applyChanges may throw (bad increment / path) — because nothing is written
    // to storage until the loop completes, a failure leaves the collection intact.
    const proposed = new Map<DocumentId, Document>();
    for (const doc of matches) {
      const updated = clone(doc);
      applyChanges(updated, changes);
      proposed.set(doc._id, updated);
    }

    const resulting = new Map(this.documents);
    for (const [id, doc] of proposed) resulting.set(id, doc);
    this.assertUnique(resulting.values());

    for (const [id, doc] of proposed) this.documents.set(id, doc);
    return proposed.size;
  }

  /** Deletes the document with the given id. Returns whether it existed. */
  async delete(id: DocumentId): Promise<boolean> {
    return this.documents.delete(id);
  }

  /**
   * Creates an index over the fields in `spec` (`1` ascending, `-1`
   * descending). With `{ unique: true }` the database enforces that no two
   * documents share the indexed key(s).
   *
   * This is a deliberately minimal implementation: the direction is recorded
   * but queries still scan; the index's job here is constraint enforcement.
   * Idempotent for an identical spec + options.
   *
   * @throws {DuplicateKeyError} when existing data already violates a requested
   *   unique constraint.
   */
  async ensureIndex(spec: IndexSpec, options: IndexOptions = {}): Promise<void> {
    const fields = Object.keys(spec);
    if (fields.length === 0) {
      throw new DatabaseError('Index spec must contain at least one field.');
    }
    for (const field of fields) {
      const direction = spec[field];
      if (direction !== 1 && direction !== -1) {
        throw new DatabaseError(
          `Invalid index direction for "${field}": expected 1 or -1.`,
        );
      }
    }

    const unique = Boolean(options.unique);
    const existing = this.indexes.find((def) => sameFields(def.fields, fields));
    if (existing) {
      if (existing.unique !== unique) {
        throw new DatabaseError(
          `Index on { ${fields.join(', ')} } already exists with different options.`,
        );
      }
      return; // idempotent
    }

    const def: IndexDefinition = { fields, spec: { ...spec }, unique };
    this.indexes.push(def);
    try {
      this.assertUnique(this.documents.values());
    } catch (error) {
      this.indexes.pop(); // roll back the half-created index
      throw error;
    }
  }

  /** Describes the indexes defined on this collection. */
  listIndexes(): IndexDescription[] {
    return this.indexes.map((def) => ({
      fields: [...def.fields],
      spec: { ...def.spec },
      unique: def.unique,
    }));
  }

  /** Verifies that the given documents satisfy every unique index. */
  private assertUnique(docs: Iterable<Document>): void {
    const uniqueIndexes = this.indexes.filter((def) => def.unique);
    if (uniqueIndexes.length === 0) return;

    const seen = uniqueIndexes.map(() => new Set<string>());
    for (const doc of docs) {
      uniqueIndexes.forEach((def, i) => {
        // A missing indexed field indexes as `null` (so a missing field and an
        // explicit `null` collide, mirroring MongoDB).
        const values = def.fields.map((field) => getPath(doc, field) ?? null);
        const key = canonicalKey(values);
        if (seen[i]!.has(key)) {
          throw new DuplicateKeyError(def.fields, values);
        }
        seen[i]!.add(key);
      });
    }
  }
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, index) => field === b[index]);
}

/**
 * Canonical, type-tagged encoding of a value for index-key comparison. Designed
 * to agree with `deepEqual`: object key order is normalised, and types are
 * tagged so that e.g. the number `1` and the string `"1"` never collide.
 */
function canonical(value: unknown): unknown {
  if (value === null) return ['null'];
  if (value instanceof Date) return ['d', value.getTime()];
  if (Array.isArray(value)) return ['a', value.map(canonical)];
  switch (typeof value) {
    case 'number':
      return ['n', value];
    case 'string':
      return ['s', value];
    case 'boolean':
      return ['b', value];
    case 'object': {
      const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]);
      return ['o', entries];
    }
    default:
      // bigint / undefined / function / symbol — outside the JSON-like domain.
      return ['x', String(value)];
  }
}

function canonicalKey(values: readonly unknown[]): string {
  return JSON.stringify(values.map(canonical));
}
