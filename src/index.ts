/**
 * @apify/hiring-database — a minimalistic, MongoDB-like document database.
 *
 * ```ts
 * import { Database, gt } from '@apify/hiring-database';
 *
 * const db = new Database();
 * const users = await db.newCollection('users');
 * await users.ensureIndex({ email: 1 }, { unique: true });
 * await users.insert({ name: 'Ada', email: 'ada@example.com', age: 36 });
 *
 * for await (const user of users.list({ age: gt(18) })) {
 *   console.log(user.name);
 * }
 * ```
 */
export { Database } from './database.js';
export { Collection } from './collection.js';

export { eq, ne, gt, gte, lt, lte, isMatcher, deepEqual, matchesFilter } from './filter.js';
export { inc, dec, unset, isUpdateOperator } from './update.js';
export type { UpdateOperator } from './update.js';
export { generateId } from './id.js';

export {
  ImdbError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  DuplicateKeyError,
  ImmutableFieldError,
} from './errors.js';

export type {
  Document,
  DocumentId,
  InsertDocument,
  Filter,
  FilterValue,
  FieldMatcher,
  ComparisonOperator,
  UpdateChanges,
  SortDirection,
  IndexSpec,
  IndexOptions,
  IndexDescription,
} from './types.js';
