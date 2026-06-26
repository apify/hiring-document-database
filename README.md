# @apify/hiring-document-database

A minimalistic, MongoDB-like document database for TypeScript.

Documents are schema-less JSON-like objects, each identified by a unique `_id`
and organized into collections. The library offers a small `async` query API
with comparison filters and unique indexes, and has **zero runtime
dependencies**.

## Features

- **Collections** — named sets of documents, created and removed at runtime.
- **CRUD** — `insert`, `get`, `list`, `update`, `delete`.
- **Filters** — equality by default, with `gt` / `gte` / `lt` / `lte` / `ne`
  comparison helpers. Multiple fields are AND-ed.
- **Updates** — set values, `inc` / `dec` numeric fields, or `unset` them.
- **Nested fields** — dot-paths (`address.city`) in filters, updates and indexes.
- **Cursors** — `list` returns a cursor: iterate it (`for await … of`),
  cap it with `.limit(n)`, or collect it with `.toArray()`.
- **Indexes** — `ensureIndex({ field: 1 | -1 }, { unique?: boolean })`, with
  enforced uniqueness (single and compound).
- **`async` data operations** — document reads and writes return promises;
  `list` returns an async iterator.

## Installation

The package is consumed directly from its Git repository — no npm registry
involved. Add it to the consuming project's `package.json` as a Git dependency:

```json
{
  "dependencies": {
    "@apify/hiring-document-database": "github:apify/hiring-in-memory-document-database"
  }
}
```

then install:

```bash
npm install
```

That's it — on install the package's `prepare` script builds it automatically
(compiling TypeScript to `dist/`), so you get ready-to-run JavaScript plus type
declarations. Both ESM and CommonJS consumers work out of the box via the
package's `exports` map, so it drops straight into, e.g., a NestJS project:

```ts
import { Database, gt } from '@apify/hiring-document-database';
```

To pin to a specific commit or tag instead of the default branch, append it
with `#`:

```json
"@apify/hiring-document-database": "github:apify/hiring-in-memory-document-database#v0.1.0"
```

## Usage

```ts
import { Database, gt } from '@apify/hiring-document-database';

const db = new Database();
const users = await db.newCollection('users');

await users.ensureIndex({ email: 1 }, { unique: true });

await users.insert({ name: 'Ada', email: 'ada@example.com', age: 36, country: 'UK' });
const bob = await users.insert({ name: 'Bob', age: 12, country: 'US' }); // _id auto-generated

// Read one by _id.
const stored = await users.get(bob._id);

// Stream matches.
for await (const user of users.list({ age: gt(18) })) {
  console.log(user.name);
}

// Update all matches; adds fields that don't exist yet. Returns the count.
const updated = await users.update({ age: gt(18) }, { adult: true });

await users.delete(bob._id);
```

### Starting from existing data

A database can be created already populated with collections and documents —
useful for tests, fixtures or restoring a known state. Pass a mapping from
collection name to its documents (an empty array creates an empty collection):

```ts
const db = new Database({
  users: [
    { _id: 'u1', name: 'Ada', age: 36 },
    { _id: 'u2', name: 'Bob', age: 12 },
  ],
  orders: [], // created empty
});

db.listCollections();      // ['users', 'orders']
db.collection('users').size; // 2
```

Seed documents go through the same path as `insert`: a missing `_id` is
auto-generated, and a duplicate `_id` within a collection throws.

## Filtering

A filter is an object: each key constrains one field, and **all keys are
combined with AND**. A bare value matches by (deep) equality; the comparison
helpers match by order.

```ts
import { eq, ne, gt, gte, lt, lte } from '@apify/hiring-document-database';

// Equality — a bare value.
users.list({ country: 'UK' });
users.list({ country: eq('UK') }); // explicit, equivalent to the above

// Ordered comparisons.
users.list({ age: gt(18) });       // age >  18
users.list({ age: gte(18) });      // age >= 18
users.list({ age: lt(65) });       // age <  65
users.list({ age: lte(65) });      // age <= 65

// Inequality.
users.list({ country: ne('UK') }); // country !== 'UK'

// Several fields at once — AND-ed together.
users.list({ country: 'UK', age: gte(18), active: true });

// Comparisons work for numbers, strings and dates.
users.list({ name: gte('M') });                 // names from 'M' onward
users.list({ createdAt: gt(new Date('2024-01-01')) });

// Nested objects and arrays match by deep (structural) equality.
users.list({ address: { city: 'Prague', zip: '11000' } });
users.list({ roles: ['admin', 'editor'] });

// Dot-paths address nested fields directly.
users.list({ 'address.city': 'Prague' });
users.list({ 'address.geo.lat': gt(50) });

// No filter (or an empty one) matches every document.
users.list();
users.list({});

// Collect results into an array.
const adults = await users.list({ age: gte(18) }).toArray();

// Cap the number of results, MongoDB-style (a limit of 0 means "no limit").
const firstPage = await users.list().limit(20).toArray();
for await (const user of users.list({ active: true }).limit(5)) {
  // …
}
```

Filters support equality and ordered comparison; there is no `$or` /
nested-operator support. Dot-paths work for both top-level and nested fields.

## Updating documents

`update(filter, changes)` applies `changes` to **every** document matching the
filter and returns the number modified. Each entry in `changes` is keyed by a
field name (dot-paths allowed). A **plain value sets** the field — adding it,
and creating intermediate objects for nested paths, if needed. The update
helpers express the other operations:

```ts
import { inc, dec, unset } from '@apify/hiring-document-database';

// Set fields (plain values).
await users.update({ _id: 'u1' }, { name: 'Ada', active: true });

// Set a nested field (creates `address` if absent).
await users.update({ _id: 'u1' }, { 'address.city': 'Paris' });

// Increment / decrement numeric fields. A missing field defaults to 0,
// so inc() on a new field starts counting from there.
await users.update({ _id: 'u1' }, { visits: inc() });     // +1
await users.update({ _id: 'u1' }, { credits: dec(5) });   // -5
await users.update({ _id: 'u1' }, { 'stats.score': inc(10) });

// Remove fields.
await users.update({ _id: 'u1' }, { tempFlag: unset(), 'profile.draft': unset() });

// Operations can be combined in a single call.
await users.update({ active: true }, { lastSeen: Date.now(), visits: inc(1) });
```

Incrementing a non-numeric field, or setting a path through a non-object value,
throws `InvalidUpdateError` and leaves the document unchanged.

## Testing

```bash
npm install        # install dependencies
npm test           # run the full test suite
npm run test:watch # re-run on change
npm run typecheck  # type-check without emitting
npm run build      # produce the distributable build
```

## API

### `Database`

| Method | Description |
| --- | --- |
| `new Database(initial?)` | Create a database, optionally pre-populated: `{ [name]: documents[] }`. |
| `newCollection(name): Promise<Collection>` | Create a collection. Throws `CollectionAlreadyExistsError` if it exists. |
| `removeCollection(name): Promise<void>` | Drop a collection. Throws `CollectionNotFoundError` if missing. |
| `collection(name): Collection` | Get an existing collection. Throws if missing. |
| `hasCollection(name): boolean` | Existence check. |
| `listCollections(): string[]` | All collection names, in creation order. |

### `Collection`

| Method | Description |
| --- | --- |
| `insert(doc): Promise<Document>` | Insert one document; auto-generates `_id` if absent. Returns the stored copy. |
| `get(id): Promise<Document \| null>` | Fetch a single document by `_id`. |
| `list(filter?): DocumentCursor` | Cursor over matches (snapshot at call time); async-iterable, with `.limit(n)` and `.toArray()`. Empty/omitted filter → all. |
| `update(filter, changes): Promise<number>` | Apply `changes` to all matches (set / `inc` / `dec` / `unset`, dot-paths supported). Returns count modified. |
| `delete(id): Promise<boolean>` | Delete by `_id`. Returns whether it existed. |
| `ensureIndex(spec, options?): Promise<void>` | Create an index (`1`/`-1`); `{ unique: true }` enforces uniqueness. Idempotent. |
| `listIndexes(): IndexDescription[]` | Describe the defined indexes. |
| `size: number` | Number of documents currently stored. |
| `name: string` | The collection's name. |

> Collections are obtained from a `Database` (`newCollection` / `collection`),
> not constructed directly.

#### `DocumentCursor` (returned by `list`)

| Member | Description |
| --- | --- |
| `for await (const doc of cursor)` | Iterate matches one at a time (documents are copies). |
| `limit(n): this` | Cap the number of results; chainable. `limit(0)` (or negative) means no limit. |
| `toArray(): Promise<Document[]>` | Collect the remaining matches into an array. |

### Utilities

A few building blocks are also exported for convenience and testing:

| Export | Description |
| --- | --- |
| `eq` / `ne` / `gt` / `gte` / `lt` / `lte` | Filter comparison helpers. |
| `inc` / `dec` / `unset` | Update operation helpers. |
| `isMatcher(value)` / `isUpdateOperator(value)` | Type guards for the helpers above. |
| `deepEqual(a, b)` | Structural equality used by filters. |
| `matchesFilter(doc, filter)` | Whether a document satisfies a filter. |
| `generateId()` | Generate a fresh document id. |

Error classes (`DatabaseError` and its subclasses `CollectionAlreadyExistsError`,
`CollectionNotFoundError`, `DuplicateKeyError`, `ImmutableFieldError`,
`InvalidUpdateError`) and the `Document`, `Filter`, `IndexSpec`, `DatabaseInit`,
`UpdateOperator` types are exported as well.

## Behaviour & limitations

- `update` affects **every** document matching the filter and adds fields that
  don't exist yet.
- `_id` is a `string`, auto-generated when omitted, and **immutable** (updating
  it throws `ImmutableFieldError`).
- Documents returned by reads are copies — mutating a returned document does not
  affect stored data.
- Mutations are **atomic**: a write that would violate a unique index is
  rejected with `DuplicateKeyError` and leaves the data unchanged.
- `ensureIndex` records sort direction and enforces `unique`; queries are not
  yet accelerated by indexes.
- **Async convention**: document reads/writes (`insert`, `get`, `update`,
  `delete`, `ensureIndex`) return promises for a consistent, forward-compatible
  surface, while cheap structural operations (`collection`, `hasCollection`,
  `listCollections`, `size`) are synchronous.
- **Value domain**: documents must hold JSON-like, structured-cloneable values
  (objects, arrays, strings, numbers, booleans, `null`, `Date`). Functions and
  class instances are not supported as field values.
- Dot-path keys containing `__proto__`, `prototype` or `constructor` are
  rejected on write, guarding against prototype pollution.
