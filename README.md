# @apify/hiring-database

A minimalistic, MongoDB-like document database for TypeScript.

Documents are schema-less JSON-like objects, each identified by a unique `_id`
and organized into collections. The library offers a small, fully `async` query
API with comparison filters and unique indexes.

## Features

- **Collections** — named sets of documents, created and removed at runtime.
- **CRUD** — `insert`, `get`, `list`, `update`, `delete`.
- **Filters** — equality by default, with `gt` / `gte` / `lt` / `lte` / `ne`
  comparison helpers. Multiple fields are AND-ed.
- **Async iteration** — `list` returns an async iterator (`for await … of`).
- **Indexes** — `ensureIndex({ field: 1 | -1 }, { unique?: boolean })`, with
  enforced uniqueness (single and compound).
- Fully `async` API.

## Usage

```ts
import { Database, gt } from '@apify/hiring-database';

const db = new Database();
const users = await db.newCollection('users');

await users.ensureIndex({ email: 1 }, { unique: true });

await users.insert({ name: 'Ada', email: 'ada@example.com', age: 36, country: 'UK' });
const bob = await users.insert({ name: 'Bob', age: 12, country: 'US' }); // _id auto-generated

// Read one by _id.
const ada = await users.get(bob._id);

// Stream matches.
for await (const user of users.list({ age: gt(18) })) {
  console.log(user.name);
}

// Update all matches; adds fields that don't exist yet. Returns the count.
const updated = await users.update({ age: gt(18) }, { adult: true });

await users.delete(bob._id);
```

## Filtering

A filter is an object: each key constrains one field, and **all keys are
combined with AND**. A bare value matches by (deep) equality; the comparison
helpers match by order.

```ts
import { eq, ne, gt, gte, lt, lte } from '@apify/hiring-database';

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

// No filter (or an empty one) matches every document.
users.list();
users.list({});

// Collecting results into an array.
const adults = [];
for await (const user of users.list({ age: gte(18) })) {
  adults.push(user);
}
```

Filters support equality and ordered comparison on top-level fields. There is
no `$or` / dot-path / nested-operator support.

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
| `list(filter?): AsyncIterableIterator<Document>` | Async iterator over matches (snapshotted at call time). Empty/omitted filter → all. |
| `update(filter, changes): Promise<number>` | Apply `changes` (field → value) to all matches; adds new fields. Returns count modified. |
| `delete(id): Promise<boolean>` | Delete by `_id`. Returns whether it existed. |
| `ensureIndex(spec, options?): Promise<void>` | Create an index (`1`/`-1`); `{ unique: true }` enforces uniqueness. Idempotent. |
| `listIndexes(): IndexDescription[]` | Describe the defined indexes. |

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
