/**
 * Public type definitions for the document database.
 *
 * The data model is intentionally schema-less: a document is any JSON-like
 * object that carries a unique `_id`. Everything else is up to the caller.
 */

/** Type of a document's primary key. */
export type DocumentId = string;

/**
 * A stored document. Schema-less apart from the mandatory `_id`.
 */
export interface Document {
  _id: DocumentId;
  [field: string]: unknown;
}

/**
 * Shape accepted by {@link Collection.insert}. `_id` is optional — when it is
 * omitted an id is auto-generated.
 */
export interface InsertDocument {
  _id?: DocumentId;
  [field: string]: unknown;
}

/** Comparison operators supported by the filter helpers. */
export type ComparisonOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';

/**
 * A field condition produced by one of the filter helpers (`gt`, `lt`, ...).
 * Callers never build these by hand — they use the helpers from `filter.ts`.
 */
export interface FieldMatcher {
  readonly __imdbMatcher: true;
  readonly op: ComparisonOperator;
  readonly value: unknown;
}

/**
 * A value in a {@link Filter}. A bare value means equality; a {@link FieldMatcher}
 * (built via the helpers) expresses a comparison.
 */
export type FilterValue = unknown | FieldMatcher;

/**
 * A query filter. Each entry constrains one field; all entries are AND-ed.
 * An empty filter matches every document.
 */
export type Filter = Record<string, FilterValue>;

/**
 * Update payload: a mapping from field name to a change. A plain value sets the
 * field (adding it if absent); the update helpers `inc` / `dec` / `unset`
 * express numeric adjustments and removals. Field names may use dot-paths (e.g.
 * `"address.city"`) to target nested properties. Applies to every document that
 * matches the filter.
 */
export type UpdateChanges = Record<string, unknown>;

/** Index sort direction, mirroring MongoDB (`1` ascending, `-1` descending). */
export type SortDirection = 1 | -1;

/** Index specification, e.g. `{ email: 1 }` or `{ lastName: 1, firstName: -1 }`. */
export type IndexSpec = Record<string, SortDirection>;

/** Options for {@link Collection.ensureIndex}. */
export interface IndexOptions {
  /** When true, no two documents may share the same indexed key(s). */
  unique?: boolean;
}

/** Read-only description of an existing index, returned by `listIndexes()`. */
export interface IndexDescription {
  readonly fields: readonly string[];
  readonly spec: IndexSpec;
  readonly unique: boolean;
}

/**
 * Initial state for a {@link Database}: a mapping from collection name to the
 * documents it starts with. Use an empty array to create an empty collection.
 */
export type DatabaseInit = Record<string, readonly InsertDocument[]>;
