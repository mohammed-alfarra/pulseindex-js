import type * as grpc from '@grpc/grpc-js';
import { QueryBuilder, type QueryExecutor } from '../builder/QueryBuilder';
import {
  PulseIndexError,
  PulseIndexConnectionError,
} from '../errors/PulseIndexError';
import {
  type BatchEntityInput,
  type BatchIndexResponse,
  type CreateSnapshotResponse,
  type DeleteResponse,
  type EncodedEntity,
  type EntityAttributes,
  type EntityId,
  type EntityInput,
  type IndexEntityRequest,
  type IndexEntityResponse,
  type PulseIndexClientConfig,
  type RecoveryState,
  type SearchRequestOptions,
  type SearchResponse,
  type SetCdcOffsetResponse,
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
   * Asks `grpc.health.v1.Health`, which the engine serves without its auth
   * interceptor and updates whenever it enters or leaves degraded recovery. So
   * this distinguishes a reachable-but-degraded engine from a healthy one, and
   * a degraded engine reports `NOT_SERVING` rather than answering normally.
   *
   * It deliberately does **not** use `GetRecoveryState`, which is the obvious
   * choice and the wrong one: that RPC requires the `admin` scope, and the
   * engine refuses `admin` to every tenant-bound key. Built on it, this method
   * returned `false` for every customer, always, whatever the engine's state.
   *
   * Returns `false` rather than throwing, so unreachable and degraded look the
   * same here. Callers holding an admin key that need to tell them apart can
   * still read `needsFullReindex` from {@link getRecoveryState}.
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
   * engine writes both that and its named service, because tonic-health pins
   * the empty key to `SERVING` at construction and never revisits it — a
   * server that only sets the named one reports a wholly degraded engine as
   * fine to any client following the spec.
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

  async createSnapshot(): Promise<CreateSnapshotResponse> {
    const raw = await this.unary<{
      success?: boolean;
      path?: string;
      lastCdcOffset?: string | number;
    }>((stub, metadata, options, callback) =>
      stub.createSnapshot({}, metadata, options, callback),
    );

    return {
      success: Boolean(raw.success),
      path: raw.path ?? '',
      lastCdcOffset: String(raw.lastCdcOffset ?? '0'),
    };
  }

  async getRecoveryState(): Promise<RecoveryState> {
    const raw = await this.unary<{
      lastCdcOffset?: string | number;
      indexedCount?: string | number;
      chunkCount?: number;
      mutationsSinceSnapshot?: string | number;
      needsFullReindex?: boolean;
    }>((stub, metadata, options, callback) =>
      stub.getRecoveryState({}, metadata, options, callback),
    );

    return {
      lastCdcOffset: String(raw.lastCdcOffset ?? '0'),
      indexedCount: String(raw.indexedCount ?? '0'),
      chunkCount: Number(raw.chunkCount ?? 0),
      mutationsSinceSnapshot: String(raw.mutationsSinceSnapshot ?? '0'),
      // Absent from engines predating the field; proto-loader `defaults: true`
      // supplies `false`, and the `??` keeps that true for any transport that
      // omits it entirely.
      needsFullReindex: Boolean(raw.needsFullReindex ?? false),
    };
  }

  async setCdcOffset(offset: EntityId): Promise<SetCdcOffsetResponse> {
    const raw = await this.unary<{ success?: boolean }>(
      (stub, metadata, options, callback) =>
        stub.setCdcOffset({ offset: String(offset) }, metadata, options, callback),
    );
    return { success: Boolean(raw.success) };
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
