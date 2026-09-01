# PulseIndex JavaScript / TypeScript SDK

Official Node.js & TypeScript client for **PulseIndex** — hosted search and filtering for large entity sets.

You send attributes to index and queries to run; PulseIndex returns matching entity IDs, which you hydrate from your own database. Your records stay in your primary store — the service holds only what it needs to answer queries.

[![CI](https://github.com/mohammed-alfarra/pulseindex-js/actions/workflows/ci.yml/badge.svg)](https://github.com/mohammed-alfarra/pulseindex-js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@pulseindex/sdk.svg)](https://www.npmjs.com/package/@pulseindex/sdk)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](#installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Key features

- Dual ESM / CommonJS build for Node.js 18+
- Typed fluent `QueryBuilder` matching `pulseindex-php`
- Zero-dependency GeoHash radius coverage (`geo:{precision}:{hash}`)
- Connection pooling, deadlines, and `x-api-key` / `Authorization: Bearer` metadata
- Attribute flattening so plain objects index without a schema (categories, flags, geo tags, price)

## Installation

```bash
npm install @pulseindex/sdk
```

```bash
pnpm add @pulseindex/sdk
```

ESM:

```ts
import PulseIndex, { GeoHash } from '@pulseindex/sdk';
```

CommonJS:

```js
const { PulseIndex, GeoHash } = require('@pulseindex/sdk');
```

Requires Node.js 18 or later. The engine gRPC endpoint defaults to `localhost:50051`.

## Quickstart

```ts
import PulseIndex, { GeoHash } from '@pulseindex/sdk';

const client = new PulseIndex({
  endpoint: 'localhost:50051',
  apiKey: process.env.PULSEINDEX_API_KEY,
  tenantId: 'acme_corp',
});

await client.index('1001', {
  categories: ['features:swimming_pool'],
  category: 'villa',
  status: 'listed',
  price: 250000,
  lat: 41.0082,
  lng: 28.9784,
});

const result = await client.search(
  PulseIndex.query()
    .tenant('acme_corp')
    .must('features:swimming_pool')
    .should(['category:villa', 'category:apartment'])
    .mustNot('status:sold')
    .range('price', 100000, 500000)
    .withinRadius({ lat: 41.0082, lng: 28.9784, radiusKm: 5 })
    .limit(50),
);

const ids = result.matchedEntityIds;
await client.close();
```

Index-time geo tags should use the same dual precision as radius queries:

```ts
const tags = GeoHash.encodeMultiTags(41.0082, 28.9784);
// ['geo:5:sxk97', 'geo:6:sxk976'] (example)
```

## gRPC configuration

Create a client against any PulseIndex Engine endpoint. Production customer gRPC should set `ssl: true` (or `PULSEINDEX_SSL=true`). The default is plaintext for local development.

```ts
const client = PulseIndex.create(
  'engine.example.com:443',
  process.env.PULSEINDEX_API_KEY,
  true,
);
```

| Option | Env var | Default | Description |
| --- | --- | --- | --- |
| `endpoint` / `host` | `PULSEINDEX_ENDPOINT`, `PULSEINDEX_HOST` | `localhost:50051` | Engine `host:port` |
| `apiKey` | `PULSEINDEX_API_KEY` | — | Sent as `x-api-key` and `Authorization: Bearer` |
| `authorization` | `PULSEINDEX_AUTHORIZATION` | — | Overrides the Bearer token when set |
| `tenantId` | `PULSEINDEX_TENANT_ID` | `''` (engine uses `default`) | Default tenant for index / search / delete |
| `timeoutMs` | — | `5000` | Per-RPC deadline |
| `ssl` | `PULSEINDEX_SSL` | `false` | Enable TLS |
| `rootCerts` / `privateKey` / `certChain` | — | — | Optional custom TLS materials |
| `poolSize` | — | `1` | Number of multiplexed gRPC clients |
| `protoPath` | — | packaged `proto/engine.proto` | Override the proto file |
| `channelOptions` | — | keepalive defaults | Extra `@grpc/grpc-js` channel options |

The engine accepts **either** `x-api-key: <key>` **or** `authorization: Bearer <key>`. Valid keys are configured on the server with `PULSEINDEX_API_KEYS`. Every mutating / query RPC that touches index state carries `tenant_id`; an empty value is normalized server-side to `"default"`.

```ts
const client = new PulseIndex({
  endpoint: process.env.PULSEINDEX_HOST,
  apiKey: process.env.PULSEINDEX_API_KEY,
  tenantId: 'acme_corp',
  timeoutMs: 5000,
  ssl: true,
  poolSize: 2,
});
```

## Indexing

`index()` accepts a string/number entity id plus a flat attribute object. Reserved keys (`price`, `tenantId`, `lat` / `lng`, `categories`, …) map onto dedicated fields; every other key becomes a namespaced term (`status:listed`, `amenities:parking`) you can filter on. Coordinates automatically add `geo:5:…` and `geo:6:…` tags.

```ts
await client.index('1001', {
  categories: ['feature:pool'],
  amenities: ['parking', 'gym'],
  furnished: true,
  price: 1500,
  lat: 24.7136,
  lng: 46.6753,
});

await client.batchIndex([
  { id: '1002', attributes: { categories: ['feature:garden'], price: 900 } },
  { entityId: 1003, categories: ['feature:pool'], price: 2000 },
]);

await client.delete('1001');
```

Low-level PHP-compatible helper:

```ts
await client.indexEntity(1001, ['feature:pool', 'amenity:parking'], 1500, 0, 'acme');
```

`entity_id` is a proto `uint64`. Pass a string when the id may exceed `Number.MAX_SAFE_INTEGER`.

## QueryBuilder

The engine evaluates MUST (AND), SHOULD (OR group, then AND), MUST_NOT, optional `price` ranges, and returns ids only. `QueryBuilder` is immutable: each chained call returns a new builder.

```ts
const query = client
  .query()
  .tenant('acme_corp')
  .must('feature:pool')
  .should(['category:villa', 'category:apartment'])
  .mustNot('status:sold')
  .range('price', 1000, 5000)
  .withinRadius({ lat: 24.7136, lng: 46.6753, radiusKm: 5 })
  .limit(50)
  .offset(0);

const page = await query.execute();
```

Equivalent object form:

```ts
await client.search({
  tenantId: 'acme_corp',
  must: 'feature:pool',
  should: ['category:villa', 'category:apartment'],
  mustNot: 'status:sold',
  ranges: [{ field: 'price', min: 100000, max: 500000 }],
  withinRadius: { lat: 41.0082, lng: 28.9784, radiusKm: 5 },
  limit: 50,
});
```

| Method | Effect |
| --- | --- |
| `tenant(id)` | Set `tenant_id` |
| `must(attr \| attr[])` | MUST filters |
| `should(attr \| attr[])` | SHOULD filters (OR group) |
| `mustNot(attr \| attr[])` | MUST_NOT filters |
| `range(field, min, max)` | Numeric range (currently `price`) |
| `withinRadius(lat, lon, km)` / `withinRadius({ lat, lng, radiusKm })` | SHOULD geo covering |
| `whereGeoHash(hash)` / `inGeoHash(hash)` | MUST exact geo cell |
| `location(prefix)` | Coarse `location_prefix` |
| `limit(n)` / `offset(n)` | Pagination (`0` = unlimited) |
| `toRequest()` | Compile the proto-shaped payload |
| `execute()` | Search via the bound client |

## GeoHash usage

Precision is chosen from radius, then covering cells are emitted as SHOULD `geo:{precision}:{hash}` tags:

| Radius | Precision | Approximate cell |
| --- | --- | --- |
| ≤ 1.5 km | 6 | ~1.2 km × 0.6 km |
| ≤ 8.0 km | 5 | ~4.9 km × 4.9 km |
| > 8.0 km | 4 | ~39 km × 19 km |

`GeoHash.neighborhood3x3()` returns the centre cell plus eight neighbors. `withinRadius()` uses intersecting covering cells (same algorithm as `pulseindex-php`) so oversized neighbors are not OR'd in.

```ts
import { GeoHash } from '@pulseindex/sdk';

GeoHash.encode(42.6, -5.6, 5); // 'ezs42'
GeoHash.tag('ezs42'); // 'geo:5:ezs42'
GeoHash.encodeMultiTags(41.0082, 28.9784);
GeoHash.neighborhood3x3('ezs42'); // centre + 8 neighbors
query.whereGeoHash('ezs42'); // MUST geo:5:ezs42
```

Also available: `decode`, `decodeBounds`, `neighbor`, `neighbors`, `neighborhoodTags`, `optimalPrecisionForRadius`, `getCoveringHashes`, `encodeTag`, `haversineKm`.

## Error handling

All RPC failures wrap gRPC status codes. Catch the typed subclass that matches the failure mode:

```ts
import {
  PulseIndexAuthError,
  PulseIndexConnectionError,
  PulseIndexQueryError,
} from '@pulseindex/sdk';

try {
  await client.search(PulseIndex.query().must('feature:pool').limit(20));
} catch (error) {
  if (error instanceof PulseIndexAuthError) {
    // UNAUTHENTICATED / PERMISSION_DENIED — check x-api-key
  } else if (error instanceof PulseIndexConnectionError) {
    // UNAVAILABLE / DEADLINE_EXCEEDED — engine down or timeout
  } else if (error instanceof PulseIndexQueryError) {
    // INVALID_ARGUMENT / RESOURCE_EXHAUSTED — bad query or capacity
  } else {
    throw error;
  }
}
```

| Class | Typical gRPC statuses |
| --- | --- |
| `PulseIndexError` | Base class (`code`, `grpcStatusCode`, `grpcDetails`) |
| `PulseIndexConnectionError` | `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `CANCELLED`, `ABORTED` |
| `PulseIndexAuthError` | `UNAUTHENTICATED`, `PERMISSION_DENIED` |
| `PulseIndexQueryError` | `INVALID_ARGUMENT`, `FAILED_PRECONDITION`, `RESOURCE_EXHAUSTED`, … |

`client.health()` returns `false` instead of throwing when the channel is not ready.

### Health

`client.health()` is `true` only when the service can **serve reads**: the channel
is ready and the standard health protocol reports `SERVING`. A reachable service
that cannot currently answer queries reports `false`, so reachability alone is not
treated as health.

It returns `false` rather than throwing, which means unreachable and unavailable
look the same. Use `servingStatus()` when you need to tell them apart:

```ts
import { SERVING_STATUS } from '@pulseindex/sdk';

const status = await client.servingStatus();
status === SERVING_STATUS.SERVING;       // ready for queries
status === SERVING_STATUS.NOT_SERVING;   // reachable, not currently serving
```

`health()` needs no particular scope on your API key — it does not send one.

If `health()` stays `false` for more than a few minutes, retry with backoff rather
than failing your own requests immediately; if it persists, contact support.

## API reference

### `PulseIndex` / `PulseIndexClient`

| Method | Returns | Description |
| --- | --- | --- |
| `new PulseIndex(config)` | client | Create a pooled gRPC client |
| `PulseIndex.create(host, apiKey?, ssl?)` | client | Convenience constructor |
| `PulseIndex.query()` | `QueryBuilder` | Unbound fluent query |
| `client.query()` | `QueryBuilder` | Bound builder (`execute()` calls `search`) |
| `client.search(query \| options)` | `SearchResponse` | Run `Search` |
| `client.index(id, attributes)` | `{ success }` | Upsert one entity |
| `client.batchIndex(entities)` | `{ indexedCount }` | Batch upsert |
| `client.delete(id)` | `{ success }` | Soft-delete an entity |
| `client.health()` | `boolean` | Channel ready + `grpc.health.v1` reports `SERVING` |
| `client.servingStatus(service?)` | `number` | Raw `grpc.health.v1` status; `''` is the whole server |
| `client.createSnapshot()` | operation metadata | Operator use; requires an elevated key |
| `client.getRecoveryState()` | index metrics | Operator use; requires an elevated key |
| `client.setCdcOffset(offset)` | `{ success }` | Operator use; requires an elevated key |
| `client.close()` | `void` | Shut down the channel pool |

`SearchResponse`:

```ts
{
  matchedEntityIds: string[];
  totalMatches: number;
  executionTimeUs: number;
}
```

## gRPC contract

Service: `pulseindex.engine.v1.SearchEngineService`

| RPC | Request | Response |
| --- | --- | --- |
| `IndexEntity` | `IndexEntityRequest` | `IndexEntityResponse` |
| `BatchIndexEntities` | `BatchIndexEntitiesRequest` | `BatchIndexEntitiesResponse` |
| `DeleteEntity` | `DeleteEntityRequest` | `DeleteEntityResponse` |
| `Search` | `SearchQueryRequest` | `SearchQueryResponse` |
| `CreateSnapshot` | `CreateSnapshotRequest` | `CreateSnapshotResponse` |
| `GetRecoveryState` | `GetRecoveryStateRequest` | `GetRecoveryStateResponse` |
| `SetCdcOffset` | `SetCdcOffsetRequest` | `SetCdcOffsetResponse` |

The service also answers the standard `grpc.health.v1.Health` protocol. No API key
is required for it, and none is sent. It responds for two names: the service's own,
and `''` — the overall-server name from the health spec. Either is fine; `health()`
uses `''`.

## Proto drift

`proto/engine.proto` is a vendored copy of the engine's. Two guards keep it honest:

| command | catches | runs in CI |
| --- | --- | --- |
| `npm test` (`tests/ProtoSchema.test.ts`) | any change to the vendored schema — field added, removed, renamed, renumbered, retyped, or an RPC changed | yes |
| `npm run check:proto` | the **engine** moving ahead of this copy | no — the engine is a separate private repository |

`check:proto` finds the engine at `$PULSEINDEX_PROTO` or a sibling checkout and
skips (exit 0) when neither is present, so run it locally with the engine checked
out beside this repository before syncing the proto. It reports schema differences
semantically, and treats a comment-only difference as a warning rather than an error.

The client reads response fields by name with `?? default` fallbacks, so a field the
engine renames or removes is **silent at runtime** — the fallback simply wins. That
is why the schema fixture is asserted in full rather than spot-checked.

## Publishing

CI runs on every push and pull request to `main` against Node.js 20, 22, and 24. The published client still supports Node.js 18+; the test toolchain (Vitest / Vite 7) requires Node 20.19+.

To publish to npm, create a GitHub Release. The [publish workflow](.github/workflows/publish.yml) builds, tests, and runs `npm publish` using the `NPM_TOKEN` repository secret.

```bash
git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 --title "v1.0.0" --generate-notes
```

## Development

```bash
npm install
npm test
npm run build
```

Unit tests cover `QueryBuilder` compilation, GeoHash precision / neighbors / bounding-box math, and `x-api-key` metadata. Integration tests spin up an in-process mocked gRPC `SearchEngineService`.

## License

MIT
