# Changelog

## 4.0.1

### The covering threshold, corrected against a real app

`withinRadius` is a pre-filter the caller narrows exactly afterwards, so excess
area is cheaper than predicates. 4.0.0's threshold was too strict: it rejected
the coarse cell at 5 km, turning a 10-cell covering into 167. Measured through
the sibling PHP SDK against a real application with 100,000 properties, a 5 km
radius went from 3,082 µs to 926 µs on wall time — the cost is the request, not
the search.

The coarse cell is now taken up to 3.0× the circle, which still rejects it at
2 km where it wastes 4.73× to 6.91×. Both SDKs are regenerated against one
shared vector fixture, so they still agree cell for cell.

## 4.0.0

**A major, not a minor.** The previous draft of these notes said 3.2.0. Checking
what actually breaks says otherwise, so the number says otherwise too.

### Breaking

1. **`withinRadius` returns different results.** It has to: above 8 km it was
   returning **nothing at all**, and below that it over-matched by up to 5.4x.
   Measured against a real engine with 20,000 points:

   | radius | true | before | after |
   |--------|-----:|-------:|------:|
   | 2 km   | 7    | 38     | 9     |
   | 5 km   | 36   | 109    | 42    |
   | 15 km  | 386  | **0**  | 518   |
   | 50 km  | 4,282| **0**  | 4,800 |

2. **`getCoveringHashes()` refuses a precision nothing is indexed at.** Passing
   4 used to return cells that matched no entity; it now throws.

3. **A radius too large for the indexed precisions is refused**, naming the
   latitude. Cells narrow toward the poles, so 50 km is available to about 82
   degrees and 15 km to about 89. Previously such a request came back
   silently covering a fraction of its own circle.

4. **`SearchResponse` gained a required `totalIsExact`.** Code that *builds* the
   type — a test double, a cache, a mapper — fails to compile until it sets it
   (`TS2741`). Code that only reads search results is unaffected.

### Migrating

Nothing to change for the common case: index the same way, call `withinRadius`
the same way, and get results that are actually inside the radius you asked for.

If you pinned expectations to the old counts, they will move. If you passed an
explicit precision, pass one of the indexed precisions or drop the argument. If
you search above 80 degrees latitude at a large radius, catch the refusal.

### Everything else in this release

### The total on a paged search is not the number of matches

A paged search stops as soon as the page is full — that is what makes it cost
microseconds — so the total it reports is whatever it had counted when it
stopped. On a million entities, a query with 166,325 matches reported 10,866
when asked for a page of 100. Anything printing "page 1 of N" from that number
is wrong by an order of magnitude and looks entirely fine.

The result now says which it is, and there is a call that gets you the real one:

```ts
const page = await client.search(query.limit(20));
page.totalIsExact;   // false — the search early-exited

const both = await client.searchWithTotal(query.limit(20));
both.totalIsExact;   // true, at the cost of a second round trip
both.totalMatches;   // the real total
```

`limit(0)` still asks for the count alone and is exact by itself; nothing about
that changed, and `searchWithTotal` skips its second call when you already
passed it.


### `withinRadius` was returning nothing above 8 km

`optimalPrecisionForRadius` chose geohash precision 4 for any radius over 8 km,
and entities are only ever tagged at precisions 5 and 6. A covering at
precision 4 therefore matched **nothing at all**. Measured against a real
engine with 20,000 points around Riyadh:

| radius | true matches | returned, before | returned, after |
|--------|-------------:|-----------------:|----------------:|
| 2 km   | 7            | 38               | 9               |
| 5 km   | 36           | 109              | 42              |
| 15 km  | 386          | **0**            | 518             |
| 50 km  | 4,282        | **0**            | 4,800           |

The precision is now always one the index carries, and of those the finest
whose complete covering fits a cell budget. Small radii also tightened: 2 km
went from 5.4x the true count to 1.3x.

### A covering is no longer truncated in silence

The 64-cell limit stopped the search mid-covering and returned what it had, so
a 50 km circle came back covered 18% and a 1 km circle at fine precision came
back covered 30% — with no error either time. The limit is now a budget the
precision is chosen to fit, so the covering always completes. A radius too
large for any indexed precision is refused by name.

### `withinRadius` is a pre-filter, not an exact radius

Cells are rectangles and the query is a circle, so the result still contains
some points outside it — now about 1.1x to 1.8x the circle's area rather than
up to 6x. The engine stores no coordinates, so only you can filter the
remainder, from your own data after hydration. This was always true and was
never written down.


### Delete many entities in one call

`delete()` takes a single id, so clearing a catalogue meant one round trip per
row. There was no other way to do it through the API at all.

```ts
for (const page of pages(idsToRemove, 10_000)) {
  const { deletedCount } = await client.batchDelete(page);
}
```

Up to 10,000 ids per call. A larger page is refused by name rather than
truncated, so a page that is too big fails loudly instead of deleting part of
itself and reporting success.

Ids that are unknown or already deleted are skipped rather than refused, so
retrying a page that half-applied is safe. `deletedCount` is the number of rows
that actually changed, which is lower than the number of ids you sent whenever
some were already gone.

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
