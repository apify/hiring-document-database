import { DuplicateKeyError, ImdbError, ImmutableFieldError } from './errors.js';
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
 */
export class Collection {
  private readonly documents = new Map<DocumentId, Document>();
  private readonly indexes: IndexDefinition[] = [];

  constructor(public readonly name: string) {}

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
    const cloned = clone(input);
    const id = cloned._id ?? generateId();
    const doc: Document = { ...cloned, _id: id };

    if (this.documents.has(id)) {
      throw new DuplicateKeyError(['_id'], id);
    }
    this.assertUnique([...this.documents.values(), doc]);

    this.documents.set(id, doc);
    return clone(doc);
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
      throw new ImdbError('Index spec must contain at least one field.');
    }
    for (const field of fields) {
      const direction = spec[field];
      if (direction !== 1 && direction !== -1) {
        throw new ImdbError(
          `Invalid index direction for "${field}": expected 1 or -1.`,
        );
      }
    }

    const unique = Boolean(options.unique);
    const existing = this.indexes.find((def) => sameFields(def.fields, fields));
    if (existing) {
      if (existing.unique !== unique) {
        throw new ImdbError(
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

  /** Builds the lookup key for a unique index from a document's field values. */
  private indexKey(fields: string[], doc: Document): string {
    return JSON.stringify(
      fields.map((field) => {
        const value = getPath(doc, field);
        return value === undefined ? null : value;
      }),
    );
  }

  /** Verifies that the given documents satisfy every unique index. */
  private assertUnique(docs: Iterable<Document>): void {
    const uniqueIndexes = this.indexes.filter((def) => def.unique);
    if (uniqueIndexes.length === 0) return;

    const seen = uniqueIndexes.map(() => new Set<string>());
    for (const doc of docs) {
      uniqueIndexes.forEach((def, i) => {
        const key = this.indexKey(def.fields, doc);
        if (seen[i]!.has(key)) {
          throw new DuplicateKeyError(def.fields, JSON.parse(key));
        }
        seen[i]!.add(key);
      });
    }
  }
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, index) => field === b[index]);
}
