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

export interface CreateSnapshotResponse {
  success: boolean;
  path: string;
  lastCdcOffset: string;
}

export interface RecoveryState {
  lastCdcOffset: string;
  indexedCount: string;
  chunkCount: number;
  mutationsSinceSnapshot: string;
  /**
   * True when the engine lost both snapshot generations at cold boot. The index
   * is empty, `Search` returns `UNAVAILABLE`, and the ingestion pipeline must
   * re-push every live entity before calling `POST /recovery/reindex-complete`.
   *
   * Engines older than the field report `false`.
   */
  needsFullReindex: boolean;
}

export interface SetCdcOffsetResponse {
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
  poolSize?: number;
  channelOptions?: Record<string, unknown>;
}

export const UINT32_MAX = 4_294_967_295;
export const DEFAULT_ENDPOINT = 'localhost:50051';
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_POOL_SIZE = 1;
