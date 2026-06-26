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

/** Deep copy used at every boundary so callers can never mutate stored state. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * A collection index.
 *
 * A **unique** index keeps a live `entries` map from each document's canonical
 * key (the combination of its indexed field values) to the id that holds it.
 * Maintaining this map incrementally on every write makes uniqueness checks
 * O(1) per document, so inserting `n` documents is O(n) rather than O(n²).
 *
 * A **non-unique** index has no `entries` map: its direction is recorded but
 * nothing is enforced and queries still scan.
 */
class Index {
  /** Canonical key -> id of the holder, for unique indexes; `null` otherwise. */
  readonly entries: Map<string, DocumentId> | null;

  constructor(
    readonly fields: string[],
    readonly spec: IndexSpec,
    readonly unique: boolean,
  ) {
    this.entries = unique ? new Map<string, DocumentId>() : null;
  }

  /** The indexed field values of a document (a missing field reads as `null`). */
  valuesOf(doc: Document): unknown[] {
    return this.fields.map((field) => getPath(doc, field) ?? null);
  }

  /** The canonical lookup key of a document on this index. */
  keyOf(doc: Document): string {
    return canonicalKey(this.valuesOf(doc));
  }
}

/**
 * A MongoDB-like cursor over query results, returned by {@link Collection.list}.
 *
 * It is async-iterable (`for await … of`), can be drained into an array with
 * {@link DocumentCursor.toArray}, and the number of results can be capped with
 * {@link DocumentCursor.limit}. The matching set is snapshotted when `list` is
 * called, and documents are copied as they are produced, so a cursor never
 * exposes — or is disturbed by — later writes.
 *
 * Obtain a cursor from `Collection.list`, not by constructing one directly.
 */
export class DocumentCursor implements AsyncIterableIterator<Document> {
  private position = 0;
  private maxResults: number | null = null;

  constructor(private readonly snapshot: readonly Document[]) {}

  /**
   * Caps the number of documents the cursor yields, and returns the cursor for
   * chaining. Following MongoDB, a limit of `0` (or negative) means "no limit".
   */
  limit(count: number): this {
    this.maxResults = count > 0 ? count : null;
    return this;
  }

  private get end(): number {
    return this.maxResults === null
      ? this.snapshot.length
      : Math.min(this.maxResults, this.snapshot.length);
  }

  async next(): Promise<IteratorResult<Document>> {
    if (this.position < this.end) {
      return { value: clone(this.snapshot[this.position++]!), done: false };
    }
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Document> {
    return this;
  }

  /** Drains the (remaining) cursor into an array of document copies. */
  async toArray(): Promise<Document[]> {
    const out: Document[] = [];
    for (let r = await this.next(); !r.done; r = await this.next()) {
      out.push(r.value);
    }
    return out;
  }
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
  private readonly indexes: Index[] = [];

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

    // Check every unique index against its key map (O(1) each) before mutating
    // anything, so a collision on a later index leaves the collection unchanged.
    const additions: Array<{ entries: Map<string, DocumentId>; key: string }> = [];
    for (const index of this.indexes) {
      if (!index.entries) continue;
      const values = index.valuesOf(doc);
      const key = canonicalKey(values);
      if (index.entries.has(key)) {
        throw new DuplicateKeyError(index.fields, values);
      }
      additions.push({ entries: index.entries, key });
    }

    this.documents.set(id, doc);
    for (const { entries, key } of additions) {
      entries.set(key, id);
    }
    return doc;
  }

  /** Returns a copy of the document with the given id, or `null` if absent. */
  async get(id: DocumentId): Promise<Document | null> {
    const doc = this.documents.get(id);
    return doc ? clone(doc) : null;
  }

  /**
   * Returns a {@link DocumentCursor} over copies of every document matching
   * `filter` (defaults to all). The matching set is snapshotted when `list` is
   * called, so writes made afterwards never disturb iteration. The cursor is
   * async-iterable and also supports `.limit(n)` and `.toArray()`.
   *
   * ```ts
   * const recent = await users.list({ active: true }).limit(10).toArray();
   * ```
   */
  list(filter: Filter = {}): DocumentCursor {
    const snapshot = [...this.documents.values()].filter((doc) =>
      matchesFilter(doc, filter),
    );
    return new DocumentCursor(snapshot);
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

    // Build the updated documents up front. applyChanges may throw (bad
    // increment / path); since nothing is committed until every check below
    // passes, a failure leaves the collection unchanged.
    const updated = new Map<DocumentId, Document>();
    for (const doc of matches) {
      const next = clone(doc);
      applyChanges(next, changes);
      updated.set(doc._id, next);
    }

    this.assertUpdateKeepsUniqueness(updated);

    // Commit. Per unique index, vacate the updated documents' old keys, then
    // claim their new ones — so a swap of two values commits cleanly.
    for (const index of this.indexes) {
      if (!index.entries) continue;
      for (const id of updated.keys()) {
        index.entries.delete(index.keyOf(this.documents.get(id)!));
      }
      for (const [id, doc] of updated) {
        index.entries.set(index.keyOf(doc), id);
      }
    }
    for (const [id, doc] of updated) {
      this.documents.set(id, doc);
    }
    return updated.size;
  }

  /** Deletes the document with the given id. Returns whether it existed. */
  async delete(id: DocumentId): Promise<boolean> {
    const doc = this.documents.get(id);
    if (!doc) return false;

    this.documents.delete(id);
    for (const index of this.indexes) {
      index.entries?.delete(index.keyOf(doc));
    }
    return true;
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
    const existing = this.indexes.find((index) => sameFields(index.fields, fields));
    if (existing) {
      if (existing.unique !== unique) {
        throw new DatabaseError(
          `Index on { ${fields.join(', ')} } already exists with different options.`,
        );
      }
      return; // idempotent
    }

    const index = new Index(fields, { ...spec }, unique);
    // Populate a unique index from existing data, rejecting any duplicate. The
    // index is only registered once it has been built successfully.
    if (index.entries) {
      for (const doc of this.documents.values()) {
        const values = index.valuesOf(doc);
        const key = canonicalKey(values);
        if (index.entries.has(key)) {
          throw new DuplicateKeyError(index.fields, values);
        }
        index.entries.set(key, doc._id);
      }
    }
    this.indexes.push(index);
  }

  /** Describes the indexes defined on this collection. */
  listIndexes(): IndexDescription[] {
    return this.indexes.map((index) => ({
      fields: [...index.fields],
      spec: { ...index.spec },
      unique: index.unique,
    }));
  }

  /**
   * Verifies that applying `updated` (id -> new document) violates no unique
   * index, consulting each index's key map for O(matches) lookups rather than
   * rescanning the whole collection. Throws on the first conflict.
   */
  private assertUpdateKeepsUniqueness(
    updated: Map<DocumentId, Document>,
  ): void {
    for (const index of this.indexes) {
      if (!index.entries) continue;
      const claimed = new Map<string, DocumentId>();
      for (const [id, doc] of updated) {
        const values = index.valuesOf(doc);
        const key = canonicalKey(values);

        // Two updated documents cannot end up with the same key…
        if (claimed.has(key)) {
          throw new DuplicateKeyError(index.fields, values);
        }
        claimed.set(key, id);

        // …nor can an updated document collide with one that is staying put. A
        // holder that is itself being updated is vacating this key, so allow it.
        const holder = index.entries.get(key);
        if (holder !== undefined && !updated.has(holder)) {
          throw new DuplicateKeyError(index.fields, values);
        }
      }
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
