# Changelog

## 3.1.0

### A radius no longer merges with your own OR

`withinRadius` turns a circle into one SHOULD filter per covering geohash cell.
Every SHOULD went into the same disjunction, so a radius sat in the same OR as
anything else you had asked for:

```ts
PulseIndex.query().should(['color:red', 'color:blue']).withinRadius(lat, lon, 5)
```

asked for "within 5 km **or** red **or** blue". It returned a plausible page of
results and said nothing about it. The cells now form a disjunction of their
own, and each further radius gets another, so that query means what it reads
like. Nothing changes for a query that used one or the other but not both.

### Groups: (red or blue) and (small or medium)

`should()` takes a group number. Members of a group are OR'd together and the
groups are AND'd with each other:

```ts
PulseIndex.query()
  .should(['color:red', 'color:blue'], 1)
  .should(['size:s', 'size:m'], 2);
```

Left unset it is 0, which is one disjunction — exactly what every existing
query already does.

### Ordering

`sortAsc(field)`, `sortDesc(field)` and `sortBy(field, descending)`, plus
`sortBy` on the plain options form:

```ts
await client.search(PulseIndex.query().must('status:active').sortAsc('price'));
```

Rows carrying no value for the field sort last in both directions; they still
count towards `totalMatches`, they simply have nothing to be ordered by.

An ordered search cannot stop as soon as the page is full — the cheapest
remaining row may be anywhere in the tenant — so it costs more than the same
filter unordered. `offset + limit` is capped at 100,000 and a request past it
is refused with the ceiling named.

## 3.0.0

### Breaking: a query returns a page instead of everything

`QueryBuilder` defaulted to a limit of 0, which the engine read as "no
ceiling" and answered with every matching id the tenant held. Nobody calling
`search()` without a limit meant to ask for that, and the cost of it landed on
the service rather than on the caller who never mentioned one.

The default is now `DEFAULT_LIMIT`, a hundred, on the builder and on the plain
options object alike. If you relied on getting every match back, say so:

```ts
await client.search(PulseIndex.query().tenant('acme').must('status:active').limit(5000));
```

A limit above the engine's maximum is refused with the maximum named, rather
than quietly trimmed — a short page that looks complete is worse than an error.

### Zero now means the count

`limit(0)` no longer means "no ceiling". It asks the engine for the number of
matches and no ids at all, which is the cheap way to count:

```ts
const { totalMatches } = await client.search(
  PulseIndex.query().tenant('acme').must('status:active').limit(0),
);
```

Requires an engine that speaks this contract. Against an older engine, a limit
of 0 still returns every id.

## 2.0.0

### Breaking: the operator-only methods are gone

Three methods that no API key could ever call have been removed, along with
their types. Every attempt returned a permission error, so nothing that worked
before stops working. If you were calling them and handling the failure, that
is the code to delete.

**Checking readiness:** use `health()`, or `servingStatus()` when you need to
tell "not answering" apart from "not reachable". Both work with any key.

### `health()` no longer reports false for every key

`health()` returned `false` no matter how the service was actually doing. It
now uses the standard `grpc.health.v1.Health` protocol. The signature is
unchanged — if you were working around this by ignoring `health()`, you can
stop.

### Added

- `client.servingStatus(service?)` — the raw serving status, for telling
  "reachable but not serving" apart from "no answer at all". Defaults to `''`,
  the overall-server name from the health spec.
- `SERVING_STATUS` — the status constants, exported from the package root.
- `healthProtoPath` on the client config, for the rare case of overriding the
  bundled `health.proto`.

`proto/health.proto` ships with the package. It is the standard health
protocol, vendored rather than pulled in as a dependency.

### Compatibility

Against a service deployed before this release, the health protocol answers but
always reports `SERVING`. `health()` is then equivalent to a reachability check.

## Earlier versions

1.x was withdrawn and is not installable. 2.0.0 is the first supported release.
