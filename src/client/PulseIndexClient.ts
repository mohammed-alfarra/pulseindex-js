import type * as grpc from '@grpc/grpc-js';
import { QueryBuilder, type QueryExecutor } from '../builder/QueryBuilder';
import {
  PulseIndexError,
  PulseIndexConnectionError,
} from '../errors/PulseIndexError';
import {
  type BatchEntityInput,
  type BatchIndexResponse,
  type DeleteResponse,
  type EncodedEntity,
  type EntityAttributes,
  type EntityId,
  type EntityInput,
  type IndexEntityRequest,
  type IndexEntityResponse,
  type PulseIndexClientConfig,
  type SearchRequestOptions,
  type SearchResponse,
} from '../types';
import { ConnectionManager } from './ConnectionManager';
import { encodeEntity, toUint64String } from './encodeEntity';
import { SERVING_STATUS, type SearchEngineServiceClient } from '../grpc/loadProto';

export class PulseIndexClient implements QueryExecutor {
  readonly connection: ConnectionManager;

  constructor(config: PulseIndexClientConfig = {}) {
    this.connection = new ConnectionManager(config);
  }

  static create(
    endpoint: string,
    apiKey?: string,
    ssl?: boolean,
    extra: Omit<PulseIndexClientConfig, 'endpoint' | 'apiKey' | 'ssl'> = {},
  ): PulseIndexClient {
    return new PulseIndexClient({
      ...extra,
      endpoint,
      apiKey,
      ssl,
    });
  }

  static query(): QueryBuilder {
    return new QueryBuilder();
  }

  query(): QueryBuilder {
    return new QueryBuilder(this);
  }

  async search(query: QueryBuilder | SearchRequestOptions): Promise<SearchResponse> {
    const builder =
      query instanceof QueryBuilder
        ? query
        : QueryBuilder.fromOptions(query, this);

    const raw = await this.unary<SearchResponseWire>(
      (stub, metadata, options, callback) =>
        stub.search(builder.toRequest(this.connection.tenantId), metadata, options, callback),
    );

    return {
      matchedEntityIds: (raw.matchedEntityIds ?? []).map((id) => String(id)),
      totalMatches: Number(raw.totalMatches ?? 0),
      executionTimeUs: Number(raw.executionTimeUs ?? 0),
    };
  }

  async index(
    entityIdOrInput: EntityId | EntityInput,
    attributes: EntityAttributes = {},
  ): Promise<IndexEntityResponse> {
    const encoded = encodeEntity(entityIdOrInput, attributes, {
      tenantId: this.connection.tenantId,
    });
    const raw = await this.unary<{ success?: boolean }>(
      (stub, metadata, options, callback) =>
        stub.indexEntity(toIndexRequest(encoded), metadata, options, callback),
    );
    return { success: Boolean(raw.success) };
  }

  async indexEntity(
    entityId: EntityId,
    categories: string[] = [],
    price = 0,
    locationPrefix: EntityId = 0,
    tenantId = '',
  ): Promise<boolean> {
    const response = await this.index({
      entityId,
      categories,
      price,
      locationPrefix,
      tenantId: tenantId || this.connection.tenantId,
    });
    return response.success;
  }

  async batchIndex(
    entities: Array<EntityInput | BatchEntityInput>,
  ): Promise<BatchIndexResponse> {
    const requests = entities.map((entity) =>
      toIndexRequest(
        encodeEntity(entity, {}, { tenantId: this.connection.tenantId }),
      ),
    );

    const raw = await this.unary<{ indexedCount?: number | string }>(
      (stub, metadata, options, callback) =>
        stub.batchIndexEntities({ entities: requests }, metadata, options, callback),
    );

    return { indexedCount: Number(raw.indexedCount ?? 0) };
  }

  async delete(entityId: EntityId, tenantId?: string): Promise<DeleteResponse> {
    const raw = await this.unary<{ success?: boolean }>(
      (stub, metadata, options, callback) =>
        stub.deleteEntity(
          {
            entityId: toUint64String(entityId, 'entityId'),
            tenantId: tenantId ?? this.connection.tenantId,
          },
          metadata,
          options,
          callback,
        ),
    );
    return { success: Boolean(raw.success) };
  }

  async deleteEntity(entityId: EntityId, tenantId = ''): Promise<boolean> {
    const response = await this.delete(entityId, tenantId || this.connection.tenantId);
    return response.success;
  }

  /**
   * True only when the engine can serve reads.
   *
   * Asks `grpc.health.v1.Health`, which needs no particular scope and tracks
   * whether the service can currently answer queries. So this distinguishes a
   * reachable-but-unavailable service from a healthy one.
   *
   * Returns `false` rather than throwing, so unreachable and unavailable look
   * the same here. Use {@link servingStatus} to tell them apart.
   */
  async health(): Promise<boolean> {
    try {
      await this.connection.waitForReady();
      const status = await this.servingStatus();
      return status === SERVING_STATUS.SERVING;
    } catch {
      return false;
    }
  }

  /**
   * Raw `grpc.health.v1` serving status for a service name.
   *
   * Defaults to `''`, the overall-server key defined by the health spec. The
   * service answers for both that and its named service.
   */
  async servingStatus(service = ''): Promise<number> {
    const stub = this.connection.getHealthStub();
    return new Promise<number>((resolve, reject) => {
      stub.check(
        { service },
        this.connection.createMetadata(),
        this.connection.createCallOptions(),
        (error, response) => {
          if (error) {
            reject(PulseIndexError.fromGrpc(error));
            return;
          }
          resolve(response?.status ?? SERVING_STATUS.UNKNOWN);
        },
      );
    });
  }




  close(): void {
    this.connection.close();
  }

  private unary<T>(
    invoke: (
      stub: SearchEngineServiceClient,
      metadata: grpc.Metadata,
      options: grpc.CallOptions,
      callback: grpc.requestCallback<unknown>,
    ) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let stub: SearchEngineServiceClient;
      try {
        stub = this.connection.getStub();
      } catch (error) {
        reject(
          error instanceof PulseIndexError
            ? error
            : new PulseIndexConnectionError('Failed to acquire a gRPC channel.', {
                cause: error,
              }),
        );
        return;
      }

      invoke(
        stub,
        this.connection.createMetadata(),
        this.connection.createCallOptions(),
        (error, response) => {
          if (error) {
            reject(PulseIndexError.fromGrpc(error));
            return;
          }
          if (response === undefined || response === null) {
            reject(new PulseIndexError('Empty gRPC response.'));
            return;
          }
          resolve(response as T);
        },
      );
    });
  }
}

export class PulseIndex extends PulseIndexClient {}

interface SearchResponseWire {
  matchedEntityIds?: Array<string | number>;
  totalMatches?: number | string;
  executionTimeUs?: number | string;
}

function toIndexRequest(encoded: EncodedEntity): IndexEntityRequest {
  return {
    entityId: encoded.entityId,
    locationPrefix: encoded.locationPrefix,
    price: encoded.price,
    categories: encoded.categories,
    tenantId: encoded.tenantId,
  };
}
