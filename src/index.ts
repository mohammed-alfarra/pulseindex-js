export { PulseIndexClient, PulseIndex } from './client/PulseIndexClient';
export { ConnectionManager, sslEnabled } from './client/ConnectionManager';
export { QueryBuilder, DEFAULT_LIMIT } from './builder/QueryBuilder';
export { GeoHash } from './geo/GeoHash';
export { encodeEntity, toUint64String } from './client/encodeEntity';
export {
  PulseIndexError,
  PulseIndexConnectionError,
  PulseIndexAuthError,
  PulseIndexQueryError,
} from './errors/PulseIndexError';
export { FilterOperation } from './types';
export { SERVING_STATUS } from './grpc/loadProto';
export type {
  BatchEntityInput,
  BatchIndexResponse,
  DeleteResponse,
  EncodedEntity,
  EntityAttributes,
  EntityId,
  EntityInput,
  FilterPredicate,
  IndexEntityRequest,
  IndexEntityResponse,
  PulseIndexClientConfig,
  RadiusOptions,
  RangePredicate,
  SearchQueryRequest,
  SearchRequestOptions,
  SearchResponse,
} from './types';

import { PulseIndex } from './client/PulseIndexClient';

export default PulseIndex;
