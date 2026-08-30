import { describe, expect, it } from 'vitest';
import { FilterOperation, GeoHash, PulseIndex, PulseIndexQueryError, QueryBuilder } from '../src';

describe('QueryBuilder', () => {
  it('compiles an immutable fluent payload', () => {
    const base = new QueryBuilder();
    const built = base
      .tenant('acme')
      .must('feature:pool')
      .should('amenity:parking')
      .mustNot('feature:shared')
      .range('price', 100, 500)
      .location(42)
      .limit(25)
      .offset(10);

    expect(base.toArray().filters).toEqual([]);
    expect(built.toArray()).toEqual({
      tenantId: 'acme',
      locationPrefix: '42',
      limit: 25,
      offset: 10,
      filters: [
        { op: FilterOperation.MUST, attribute: 'feature:pool' },
        { op: FilterOperation.SHOULD, attribute: 'amenity:parking' },
        { op: FilterOperation.MUST_NOT, attribute: 'feature:shared' },
      ],
      ranges: [{ field: 'price', minVal: 100, maxVal: 500 }],
    });
  });

  it('accepts array SHOULD / MUST filters', () => {
    const request = PulseIndex.query()
      .tenant('acme_corp')
      .must('features:swimming_pool')
      .should(['category:villa', 'category:apartment'])
      .mustNot('status:sold')
      .range('price', 100000, 500000)
      .limit(50)
      .toRequest();

    expect(request.tenantId).toBe('acme_corp');
    expect(request.limit).toBe(50);
    expect(request.filters).toEqual([
      { op: FilterOperation.MUST, attribute: 'features:swimming_pool' },
      { op: FilterOperation.SHOULD, attribute: 'category:villa' },
      { op: FilterOperation.SHOULD, attribute: 'category:apartment' },
      { op: FilterOperation.MUST_NOT, attribute: 'status:sold' },
    ]);
    expect(request.ranges).toEqual([{ field: 'price', minVal: 100000, maxVal: 500000 }]);
  });

  it('adds a MUST geo tag for whereGeoHash / inGeoHash', () => {
    const viaWhere = new QueryBuilder().whereGeoHash('ezs42').toRequest();
    const viaIn = new QueryBuilder().inGeoHash('geo:5:ezs42').toArray();

    expect(viaWhere.filters).toEqual([{ op: FilterOperation.MUST, attribute: 'geo:5:ezs42' }]);
    expect(viaIn.filters).toEqual(viaWhere.filters);
  });

  it('adds SHOULD geo tags for covering hashes on withinRadius', () => {
    const lat = 42.6;
    const lon = -5.6;
    const radiusKm = 4.9;
    const covering = GeoHash.getCoveringHashes(lat, lon, radiusKm);
    const base = new QueryBuilder();
    const built = base.withinRadius(lat, lon, radiusKm);
    const request = built.toRequest();

    expect(base.toArray().filters).toEqual([]);
    expect(request.filters).toHaveLength(covering.length);
    expect(GeoHash.optimalPrecisionForRadius(radiusKm)).toBe(5);
    expect(request.filters.map((filter) => filter.attribute)).toEqual(covering.map((hash) => GeoHash.tag(hash)));
    expect(request.filters[0]).toEqual({ op: FilterOperation.SHOULD, attribute: 'geo:5:ezs42' });
    for (const filter of request.filters) {
      expect(filter.op).toBe(FilterOperation.SHOULD);
      expect(filter.attribute).toMatch(/^geo:5:[0-9bcdefghjkmnpqrstuvwxyz]+$/);
    }
  });

  it('accepts object-form withinRadius with lng', () => {
    const lat = 41.0082;
    const lng = 28.9784;
    const covering = GeoHash.getCoveringHashes(lat, lng, 5);
    const request = PulseIndex.query()
      .withinRadius({ lat, lng, radiusKm: 5 })
      .toRequest();

    expect(request.filters.map((filter) => filter.attribute)).toEqual(covering.map((hash) => GeoHash.tag(hash)));
    expect(request.filters.every((filter) => filter.op === FilterOperation.SHOULD)).toBe(true);
  });

  it('honors explicit withinRadius precision', () => {
    const covering = GeoHash.getCoveringHashes(42.6, -5.6, 1.0, 6);
    const request = new QueryBuilder().withinRadius(42.6, -5.6, 1.0, 6).toRequest();

    expect(request.filters).toHaveLength(covering.length);
    expect(request.filters[0]?.attribute).toBe(`geo:6:${covering[0]}`);
    expect(request.filters[0]?.op).toBe(FilterOperation.SHOULD);
  });

  it('builds from SearchRequestOptions', () => {
    const request = QueryBuilder.fromOptions({
      tenantId: 'acme',
      must: 'feature:pool',
      should: ['category:villa', 'category:apartment'],
      mustNot: 'status:sold',
      ranges: [{ field: 'price', min: 10, max: 20 }],
      limit: 5,
      offset: 2,
    }).toRequest();

    expect(request.tenantId).toBe('acme');
    expect(request.limit).toBe(5);
    expect(request.offset).toBe(2);
    expect(request.filters).toHaveLength(4);
    expect(request.ranges[0]).toEqual({ field: 'price', minVal: 10, maxVal: 20 });
  });

  it('rejects inverted ranges and execute without a client', () => {
    expect(() => new QueryBuilder().range('price', 500, 100)).toThrow(PulseIndexQueryError);
    expect(() => new QueryBuilder().execute()).toThrow(/no client/);
  });
});
