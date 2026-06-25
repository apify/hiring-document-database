# @apify/imdb

A minimalistic, **MongoDB-like in-memory document database** written in TypeScript.

It is intentionally small — a clean interface for a hiring task, not a Mongo
clone. Data lives in memory only (no persistence). Documents are schema-less
JSON-like objects; the only required field is a unique `_id`.

## Features

- **Collections** — named bags of documents, created/removed at runtime.
- **CRUD** — `insert`, `get`, `list`, `update`, `delete`.
- **Filters** — equality by default, with `gt` / `gte` / `lt` / `lte` / `ne`
  comparison helpers. Multiple fields are AND-ed.
- **Async iteration** — `list` returns an async iterator (`for await … of`).
- **Indexes** — `ensureIndex({ field: 1 | -1 }, { unique?: boolean })`, with
  enforced uniqueness (single and compound).
- Fully `async` API, ready to drop behind a NestJS service.

## Install

This package is consumed **directly from GitHub** — it is not published to npm.
Add it as a git dependency in the consuming project's `package.json`:

```json
{
  "dependencies": {
    "@apify/imdb": "github:apify/hiring-in-memory-document-database#claude/clever-wright-3rl05l"
  }
}
```

On `npm install`, the package's `prepare` script builds it automatically, so the
consumer gets compiled JavaScript + type declarations. The package ships **both
ESM and CommonJS** builds via the `exports` map, so it works whether your
NestJS project is CommonJS (the default) or ESM — no extra config.

> For local development you can also use `npm link` or a `file:../path`
> dependency; the git form above is the most portable.

## Usage

```ts
import { Database, gt } from '@apify/imdb';

const db = new Database();
const users = await db.newCollection('users');

await users.ensureIndex({ email: 1 }, { unique: true });

await users.insert({ name: 'Ada', email: 'ada@example.com', age: 36 });
const bob = await users.insert({ name: 'Bob', age: 12 }); // _id auto-generated

// Read one by _id.
const ada = await users.get(bob._id);

// Stream matches: equality (name) AND comparison (age > 18).
for await (const user of users.list({ age: gt(18) })) {
  console.log(user.name);
}

// Update all matches; adds fields that don't exist yet. Returns the count.
const n = await users.update({ age: gt(18) }, { adult: true });

await users.delete(bob._id);
```

### Using it in NestJS

Wrap a single shared `Database` instance in a provider:

```ts
import { Injectable } from '@nestjs/common';
import { Database } from '@apify/imdb';

@Injectable()
export class DbService extends Database {}
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

### Filters

A filter is an object whose keys are field names. A **bare value means equality**
(deep/structural for objects and arrays); wrap a value in a helper for ordered
comparisons:

```ts
import { eq, ne, gt, gte, lt, lte } from '@apify/imdb';

collection.list({ status: 'active', age: gte(18), score: lt(100) });
```

All keys are AND-ed. There is intentionally no `$or` / dot-path / nested-operator
support in this version.

## Design notes & scope

- **In-memory only**, no persistence.
- `update` affects **every** matching document (the filter is shared with `list`).
- `_id` is a `string`, auto-generated with a UUID when not supplied, and is
  **immutable** (updating it throws `ImmutableFieldError`).
- Reads and writes are **copied at the boundary** (`structuredClone`), so callers
  can never mutate stored state by holding a reference.
- Mutations are **atomic**: a write that would violate a unique index is rejected
  with `DuplicateKeyError` and leaves the collection unchanged.
- `ensureIndex` records sort direction and enforces `unique`, but queries still
  scan — index-accelerated lookups are out of scope for this task.

## Development

```bash
npm install      # install dev deps
npm test         # run the vitest suite (the spec lives in tests/)
npm run build    # emit dual CJS + ESM builds with .d.ts into dist/
npm run typecheck
```

The test suite is written red-green / TDD-style and doubles as the behavioural
specification for the database.
