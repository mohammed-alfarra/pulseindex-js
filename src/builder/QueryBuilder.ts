import { GeoHash } from '../geo/GeoHash';
import { PulseIndexQueryError } from '../errors/PulseIndexError';
import {
  FilterOperation,
  type FilterOperationCode,
  type FilterPredicate,
  type RadiusOptions,
  type RangePredicate,
  type SearchQueryRequest,
  type SearchRequestOptions,
  type SearchResponse,
} from '../types';

export interface QueryExecutor {
  search(query: QueryBuilder): Promise<SearchResponse>;
}

interface QueryState {
  tenantId: string;
  locationPrefix: string;
  limit: number;
  offset: number;
  filters: FilterPredicate[];
  ranges: RangePredicate[];
}

/**
 * A page, for callers who never say otherwise.
 *
 * The default used to be 0, which the engine read as "no ceiling" and answered
 * with every matching id the tenant held. Nobody meant to ask for that, and
 * the cost of it landed on the service rather than on the caller who forgot
 * the limit. Zero is still expressible and now means the total alone.
 */
export const DEFAULT_LIMIT = 100;

function emptyState(): QueryState {
  return {
    tenantId: '',
    locationPrefix: '0',
    limit: DEFAULT_LIMIT,
    offset: 0,
    filters: [],
    ranges: [],
  };
}

function asAttributeList(value: string | string[]): string[] {
  const items = Array.isArray(value) ? value : [value];
  const normalized = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw new PulseIndexQueryError('Attribute filter must not be empty.');
  }
  return normalized;
}

function resolveLongitude(options: RadiusOptions): number {
  const value = options.lng ?? options.lon;
  if (value === undefined) {
    throw new PulseIndexQueryError('withinRadius requires lng or lon.');
  }
  return value;
}

export class QueryBuilder {
  private readonly executor: QueryExecutor | null;
  private state: QueryState;

  constructor(executor: QueryExecutor | null = null) {
    this.executor = executor;
    this.state = emptyState();
  }

  tenant(tenantId: string): QueryBuilder {
    return this.fork((state) => {
      state.tenantId = tenantId;
    });
  }

  location(locationPrefix: string | number | bigint): QueryBuilder {
    return this.fork((state) => {
      state.locationPrefix = String(locationPrefix);
    });
  }

  must(attribute: string | string[]): QueryBuilder {
    return this.addFilters(FilterOperation.MUST, attribute);
  }

  should(attribute: string | string[]): QueryBuilder {
    return this.addFilters(FilterOperation.SHOULD, attribute);
  }

  mustNot(attribute: string | string[]): QueryBuilder {
    return this.addFilters(FilterOperation.MUST_NOT, attribute);
  }

  whereGeoHash(geohash: string): QueryBuilder {
    return this.must(GeoHash.tag(geohash));
  }

  inGeoHash(geohash: string): QueryBuilder {
    return this.whereGeoHash(geohash);
  }

  withinRadius(lat: number, lon: number, radiusKm: number, precision?: number): QueryBuilder;
  withinRadius(options: RadiusOptions): QueryBuilder;
  withinRadius(
    latOrOptions: number | RadiusOptions,
    lon?: number,
    radiusKm?: number,
    precision?: number,
  ): QueryBuilder {
    let lat: number;
    let longitude: number;
    let radius: number;
    let resolvedPrecision: number | undefined;

    if (typeof latOrOptions === 'object') {
      lat = latOrOptions.lat;
      longitude = resolveLongitude(latOrOptions);
      radius = latOrOptions.radiusKm;
      resolvedPrecision = latOrOptions.precision;
    } else {
      if (lon === undefined || radiusKm === undefined) {
        throw new PulseIndexQueryError('withinRadius(lat, lon, radiusKm) requires all three arguments.');
      }
      lat = latOrOptions;
      longitude = lon;
      radius = radiusKm;
      resolvedPrecision = precision;
    }

    const covering = GeoHash.getCoveringHashes(lat, longitude, radius, resolvedPrecision);
    return this.fork((state) => {
      for (const hash of covering) {
        state.filters.push({
          op: FilterOperation.SHOULD,
          attribute: GeoHash.tag(hash),
        });
      }
    });
  }

  range(field: string, min: number, max: number): QueryBuilder {
    if (!field.trim()) {
      throw new PulseIndexQueryError('Range field must not be empty.');
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new PulseIndexQueryError('Range bounds must be finite numbers.');
    }
    if (min > max) {
      throw new PulseIndexQueryError(`Range min (${min}) must be <= max (${max}).`);
    }

    return this.fork((state) => {
      state.ranges.push({
        field,
        minVal: Math.floor(min),
        maxVal: Math.floor(max),
      });
    });
  }

  /**
   * How many ids to return. Zero asks the engine for the number of matches
   * and no ids at all, which is the cheap way to count.
   */
  limit(limit: number): QueryBuilder {
    return this.fork((state) => {
      state.limit = Math.max(0, Math.floor(limit));
    });
  }

  offset(offset: number): QueryBuilder {
    return this.fork((state) => {
      state.offset = Math.max(0, Math.floor(offset));
    });
  }

  toRequest(defaultTenantId = ''): SearchQueryRequest {
    return {
      tenantId: this.state.tenantId || defaultTenantId,
      locationPrefix: this.state.locationPrefix,
      limit: this.state.limit,
      offset: this.state.offset,
      filters: this.state.filters.map((filter) => ({ ...filter })),
      ranges: this.state.ranges.map((range) => ({ ...range })),
    };
  }

  toArray(defaultTenantId = ''): SearchQueryRequest {
    return this.toRequest(defaultTenantId);
  }

  execute(): Promise<SearchResponse> {
    if (!this.executor) {
      throw new PulseIndexQueryError(
        'QueryBuilder has no client; pass the builder to client.search() or create it via client.query().',
      );
    }
    return this.executor.search(this);
  }

  static fromOptions(
    options: SearchRequestOptions,
    executor: QueryExecutor | null = null,
  ): QueryBuilder {
    let query = new QueryBuilder(executor);

    if (options.tenantId !== undefined) {
      query = query.tenant(options.tenantId);
    }
    if (options.locationPrefix !== undefined) {
      query = query.location(options.locationPrefix);
    }
    if (options.must !== undefined) {
      query = query.must(options.must);
    }
    if (options.should !== undefined) {
      query = query.should(options.should);
    }
    if (options.mustNot !== undefined) {
      query = query.mustNot(options.mustNot);
    }
    if (options.ranges) {
      for (const range of options.ranges) {
        query = query.range(range.field, range.min, range.max);
      }
    }
    if (options.withinRadius) {
      query = query.withinRadius(options.withinRadius);
    }
    if (options.geoHash) {
      query = query.whereGeoHash(options.geoHash);
    }
    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options.offset !== undefined) {
      query = query.offset(options.offset);
    }

    return query;
  }

  private addFilters(op: FilterOperationCode, attribute: string | string[]): QueryBuilder {
    const attributes = asAttributeList(attribute);
    return this.fork((state) => {
      for (const value of attributes) {
        state.filters.push({ op, attribute: value });
      }
    });
  }

  private fork(mutate: (state: QueryState) => void): QueryBuilder {
    const next = new QueryBuilder(this.executor);
    next.state = {
      tenantId: this.state.tenantId,
      locationPrefix: this.state.locationPrefix,
      limit: this.state.limit,
      offset: this.state.offset,
      filters: this.state.filters.map((filter) => ({ ...filter })),
      ranges: this.state.ranges.map((range) => ({ ...range })),
    };
    mutate(next.state);
    return next;
  }
}
