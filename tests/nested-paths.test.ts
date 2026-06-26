import { beforeEach, describe, expect, it } from 'vitest';

import { Collection, Database, DuplicateKeyError, gt, ne } from '../src/index.js';
import type { Document } from '../src/index.js';

async function collect(iter: AsyncIterable<Document>): Promise<Document[]> {
  const out: Document[] = [];
  for await (const doc of iter) out.push(doc);
  return out;
}

describe('dot-path filters', () => {
  let users: Collection;

  beforeEach(async () => {
    users = await new Database().newCollection('users');
    await users.insert({
      _id: '1',
      name: 'Ada',
      address: { city: 'London', geo: { lat: 51 } },
      stats: { score: 10 },
    });
    await users.insert({
      _id: '2',
      name: 'Bob',
      address: { city: 'Prague', geo: { lat: 50 } },
      stats: { score: 90 },
    });
    await users.insert({ _id: '3', name: 'Cid' }); // no nested fields at all
  });

  it('matches a nested field by equality', async () => {
    const result = await collect(users.list({ 'address.city': 'Prague' }));
    expect(result.map((d) => d._id)).toEqual(['2']);
  });

  it('matches a deeply nested field', async () => {
    const result = await collect(users.list({ 'address.geo.lat': 51 }));
    expect(result.map((d) => d._id)).toEqual(['1']);
  });

  it('applies comparison helpers to nested fields', async () => {
    const result = await collect(users.list({ 'stats.score': gt(50) }));
    expect(result.map((d) => d._id)).toEqual(['2']);
  });

  it('treats a missing nested path as undefined', async () => {
    // Cid has no `stats`; gt never matches, ne(value) does.
    expect(await collect(users.list({ 'stats.score': gt(0) }))).toHaveLength(2);
    const ne0 = await collect(users.list({ 'stats.score': ne(10) }));
    expect(ne0.map((d) => d._id).sort()).toEqual(['2', '3']);
  });

  it('does not traverse through a non-object value', async () => {
    // `name` is a string, so `name.first` resolves to undefined for everyone.
    expect(await collect(users.list({ 'name.first': 'Ada' }))).toEqual([]);
  });
});

describe('dot-path unique indexes', () => {
  it('enforces uniqueness on a nested field', async () => {
    const users = await new Database().newCollection('users');
    await users.ensureIndex({ 'profile.email': 1 }, { unique: true });
    await users.insert({ profile: { email: 'a@x.com' } });
    await expect(
      users.insert({ profile: { email: 'a@x.com' } }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    await expect(
      users.insert({ profile: { email: 'b@x.com' } }),
    ).resolves.toBeDefined();
  });
});
