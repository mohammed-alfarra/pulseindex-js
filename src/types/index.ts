export const FilterOperation = {
  MUST: 0,
  SHOULD: 1,
  MUST_NOT: 2,
} as const;

export type FilterOperationCode =
  (typeof FilterOperation)[keyof typeof FilterOperation];

export type EntityId = string | number | bigint;

export interface FilterPredicate {
  op: FilterOperationCode;
  attribute: string;
  /**
   * Which disjunction a SHOULD predicate belongs to. Ignored for MUST and
   * MUST_NOT.
   *
   * Members of a group are OR'd together and the groups are AND'd with each
   * other, so "(red or blue) and (small or medium)" is two groups. Predicates
   * that leave this unset share group 0.
   */
  group?: number;
}

/** Orders a page by a numeric field. */
export interface SortSpec {
  /** Numeric field name, the same one a range would name. */
  field: string;
  /** Largest first when true; smallest first otherwise. */
  descending: boolean;
}

export interface RangePredicate {
  field: string;
  minVal: number;
  maxVal: number;
}

export interface SearchQueryRequest {
  locationPrefix: string;
  filters: FilterPredicate[];
  ranges: RangePredicate[];
  limit: number;
  offset: number;
  tenantId: string;
  /** Absent returns matches in entity-id order. */
  sort?: SortSpec;
}

export interface SearchResponse {
  matchedEntityIds: string[];
  totalMatches: number;
  executionTimeUs: number;
}

export interface IndexEntityRequest {
  entityId: string;
  locationPrefix: string;
  price: number;
  categories: string[];
  tenantId: string;
}

export interface IndexEntityResponse {
  success: boolean;
}

export interface BatchIndexEntitiesRequest {
  entities: IndexEntityRequest[];
}

export interface BatchIndexResponse {
  indexedCount: number;
}

export interface DeleteEntityRequest {
  entityId: string;
  tenantId: string;
}

export interface DeleteResponse {
  success: boolean;
}

export interface RadiusOptions {
  lat: number;
  lng?: number;
  lon?: number;
  radiusKm: number;
  precision?: number;
}

export interface SearchRequestOptions {
  tenantId?: string;
  locationPrefix?: EntityId;
  must?: string | string[];
  should?: string | string[];
  mustNot?: string | string[];
  ranges?: Array<{ field: string; min: number; max: number }>;
  limit?: number;
  offset?: number;
  withinRadius?: RadiusOptions;
  geoHash?: string;
  /**
   * Order the page by a numeric field. `descending` defaults to false.
   *
   * Rows carrying no value for the field sort last in both directions. They
   * still count towards `totalMatches`; they have nothing to be ordered by.
   */
  sortBy?: { field: string; descending?: boolean };
}

export interface EntityAttributes {
  categories?: unknown;
  tags?: unknown;
  price?: unknown;
  locationPrefix?: unknown;
  location_prefix?: unknown;
  tenantId?: unknown;
  tenant_id?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  lat?: unknown;
  lng?: unknown;
  lon?: unknown;
  [key: string]: unknown;
}

export interface EntityInput {
  id?: EntityId;
  entityId?: EntityId;
  entity_id?: EntityId;
  attributes?: EntityAttributes;
  categories?: unknown;
  tags?: unknown;
  price?: unknown;
  locationPrefix?: unknown;
  location_prefix?: unknown;
  tenantId?: unknown;
  tenant_id?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  lat?: unknown;
  lng?: unknown;
  lon?: unknown;
  [key: string]: unknown;
}

export interface BatchEntityInput {
  id?: EntityId;
  entityId?: EntityId;
  entity_id?: EntityId;
  attributes?: EntityAttributes;
  [key: string]: unknown;
}

export interface EncodedEntity {
  entityId: string;
  categories: string[];
  price: number;
  locationPrefix: string;
  tenantId: string;
}

export interface PulseIndexClientConfig {
  endpoint?: string;
  host?: string;
  apiKey?: string;
  authorization?: string;
  tenantId?: string;
  timeoutMs?: number;
  ssl?: boolean | string | number;
  rootCerts?: Buffer;
  privateKey?: Buffer;
  certChain?: Buffer;
  protoPath?: string;
  /** Override the bundled `health.proto`. Only needed if the package layout is rewritten. */
  healthProtoPath?: string;
  poolSize?: number;
  channelOptions?: Record<string, unknown>;
}

export const UINT32_MAX = 4_294_967_295;
export const DEFAULT_ENDPOINT = 'localhost:50051';
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_POOL_SIZE = 1;
