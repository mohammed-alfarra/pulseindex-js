import * as grpc from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConnectionManager,
  FilterOperation,
  GeoHash,
  PulseIndex,
  PulseIndexAuthError,
  PulseIndexClient,
  encodeEntity,
  sslEnabled,
} from '../src';
import * as protoLoader from '@grpc/proto-loader';
import {
  loadEngineProto,
  resolveHealthProtoPath,
  PROTO_LOADER_OPTIONS,
} from '../src/grpc/loadProto';

type MetadataMap = ReturnType<grpc.Metadata['getMap']>;

interface CapturedCall {
  method: string;
  request: Record<string, unknown>;
  metadata: MetadataMap;
}

interface MockEngine {
  port: number;
  calls: CapturedCall[];
  close(): Promise<void>;
}

function metadataObject(metadata: grpc.Metadata): MetadataMap {
  return metadata.getMap();
}

async function startMockEngine(options: {
  searchIds?: string[];
  failAuth?: boolean;
  /** Serve GetRecoveryState with needs_full_reindex set (degraded recovery). */
  needsFullReindex?: boolean;
  /** Omit field 5 entirely, as an engine predating it would. */
  omitNeedsFullReindex?: boolean;
  /**
   * `grpc.health.v1` status this engine reports, for both the named service
   * and the empty overall-server key. Defaults to SERVING; 2 is NOT_SERVING.
   */
  servingStatus?: number;
  /** Serve no health service at all, as an engine predating it would. */
  omitHealthService?: boolean;
  /**
   * Refuse GetRecoveryState with PERMISSION_DENIED, which is what production
   * actually does for every customer key: that RPC needs the `admin` scope and
   * the engine refuses `admin` to any tenant-bound key.
   */
  denyRecoveryState?: boolean;
} = {}): Promise<MockEngine> {
  const { service } = loadEngineProto();
  const server = new grpc.Server();
  const calls: CapturedCall[] = [];

  const capture = (
    method: string,
    call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
  ): void => {
    calls.push({
      method,
      request: (call.request ?? {}) as Record<string, unknown>,
      metadata: metadataObject(call.metadata),
    });
  };

  if (!options.omitHealthService) {
    // The real engine adds this WITHOUT its auth interceptor, so the mock must
    // answer regardless of credentials — a health service that demanded a key
    // would not be testing the thing that makes this usable.
    const healthDef = protoLoader.loadSync(resolveHealthProtoPath(), PROTO_LOADER_OPTIONS);
    const healthPkg = grpc.loadPackageDefinition(healthDef) as unknown as {
      grpc: { health: { v1: { Health: { service: grpc.ServiceDefinition } } } };
    };
    server.addService(healthPkg.grpc.health.v1.Health.service, {
      check(
        call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
        callback: grpc.sendUnaryData<{ status: number }>,
      ) {
        capture('health.check', call);
        callback(null, { status: options.servingStatus ?? 1 });
      },
    });
  }

  server.addService(service, {
    indexEntity(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{ success: boolean }>,
    ) {
      if (options.failAuth) {
        callback({
          code: grpc.status.UNAUTHENTICATED,
          details: 'invalid api key',
        });
        return;
      }
      capture('indexEntity', call);
      callback(null, { success: true });
    },
    batchIndexEntities(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{ indexedCount: number }>,
    ) {
      capture('batchIndexEntities', call);
      const entities = (call.request?.entities as unknown[] | undefined) ?? [];
      callback(null, { indexedCount: entities.length });
    },
    deleteEntity(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{ success: boolean }>,
    ) {
      capture('deleteEntity', call);
      callback(null, { success: true });
    },
    search(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{
        matchedEntityIds: string[];
        totalMatches: number;
        executionTimeUs: string;
      }>,
    ) {
      capture('search', call);
      const ids = options.searchIds ?? ['1001'];
      callback(null, {
        matchedEntityIds: ids,
        totalMatches: ids.length,
        executionTimeUs: '42',
      });
    },
    createSnapshot(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{ success: boolean; path: string; lastCdcOffset: string }>,
    ) {
      capture('createSnapshot', call);
      callback(null, { success: true, path: '/tmp/snapshot.bin', lastCdcOffset: '9' });
    },
    getRecoveryState(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{
        lastCdcOffset: string;
        indexedCount: string;
        chunkCount: number;
        mutationsSinceSnapshot: string;
        needsFullReindex?: boolean;
      }>,
    ) {
      if (options.denyRecoveryState) {
        callback({
          code: grpc.status.PERMISSION_DENIED,
          details: 'insufficient scope',
        });
        return;
      }
      capture('getRecoveryState', call);
      const base = {
        lastCdcOffset: '9',
        indexedCount: '3',
        chunkCount: 1,
        mutationsSinceSnapshot: '0',
      };
      callback(
        null,
        options.omitNeedsFullReindex
          ? base
          : { ...base, needsFullReindex: Boolean(options.needsFullReindex) },
      );
    },
    setCdcOffset(
      call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>,
      callback: grpc.sendUnaryData<{ success: boolean }>,
    ) {
      capture('setCdcOffset', call);
      callback(null, { success: true });
    },
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(boundPort);
    });
  });

  return {
    port,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.tryShutdown((error) => {
          if (error) {
            server.forceShutdown();
          }
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

describe('PulseIndex client integration', () => {
  const clients: PulseIndexClient[] = [];
  const engines: MockEngine[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close();
    }
    for (const engine of engines.splice(0)) {
      await engine.close();
    }
  });

  it('attaches x-api-key and Bearer authorization metadata', () => {
    const connection = new ConnectionManager({
      endpoint: 'localhost:50051',
      apiKey: 'secret-key',
    });

    const metadata = connection.createMetadata().getMap();
    expect(metadata['x-api-key']).toBe('secret-key');
    expect(metadata.authorization).toBe('Bearer secret-key');
    connection.close();
  });

  it('prefers an explicit authorization token when provided', () => {
    const connection = new ConnectionManager({
      endpoint: 'localhost:50051',
      apiKey: 'secret-key',
      authorization: 'other-token',
    });

    const metadata = connection.createMetadata().getMap();
    expect(metadata['x-api-key']).toBe('secret-key');
    expect(metadata.authorization).toBe('Bearer other-token');
    connection.close();
  });

  it('treats string false as plaintext SSL', () => {
    expect(sslEnabled({ ssl: 'false' })).toBe(false);
    expect(sslEnabled({ ssl: '0' })).toBe(false);
    expect(sslEnabled({ ssl: false })).toBe(false);
    expect(sslEnabled({ ssl: true })).toBe(true);
    expect(sslEnabled({ ssl: 'true' })).toBe(true);
    expect(sslEnabled({ ssl: '1' })).toBe(true);
    expect(sslEnabled({})).toBe(false);
  });

  it('encodes attributes into namespaced bitwise terms and geo tags', () => {
    const encoded = encodeEntity('1001', {
      categories: ['feature:pool'],
      status: 'listed',
      amenities: ['parking', 'gym'],
      price: 1500,
      lat: 42.6,
      lng: -5.6,
      tenantId: 'acme',
    });

    expect(encoded.entityId).toBe('1001');
    expect(encoded.price).toBe(1500);
    expect(encoded.tenantId).toBe('acme');
    expect(encoded.categories).toEqual(
      expect.arrayContaining([
        'feature:pool',
        'status:listed',
        'amenities:parking',
        'amenities:gym',
        ...GeoHash.encodeMultiTags(42.6, -5.6),
      ]),
    );
  });

  it('sends search and index RPCs over a mocked gRPC engine', async () => {
    const engine = await startMockEngine({ searchIds: ['1001', '1003'] });
    engines.push(engine);

    const client = new PulseIndex({
      endpoint: `127.0.0.1:${engine.port}`,
      apiKey: 'dev-key',
      tenantId: 'acme',
      timeoutMs: 2000,
    });
    clients.push(client);

    const indexed = await client.index('1001', {
      categories: ['feature:pool'],
      amenities: ['parking'],
      price: 1500,
      lat: 41.0082,
      lng: 28.9784,
    });
    expect(indexed.success).toBe(true);

    const batch = await client.batchIndex([
      { id: 1002, attributes: { categories: ['feature:garden'], price: 900 } },
      { entityId: 1003, categories: ['feature:pool'], price: 2000 },
    ]);
    expect(batch.indexedCount).toBe(2);

    const result = await client.search(
      client
        .query()
        .must('feature:pool')
        .should(['category:villa', 'category:apartment'])
        .mustNot('status:sold')
        .range('price', 1000, 1800)
        .withinRadius({ lat: 41.0082, lng: 28.9784, radiusKm: 5 })
        .limit(50),
    );

    expect(result.matchedEntityIds).toEqual(['1001', '1003']);
    expect(result.totalMatches).toBe(2);
    expect(result.executionTimeUs).toBe(42);

    const deleted = await client.delete('1001');
    expect(deleted.success).toBe(true);
    expect(await client.health()).toBe(true);

    const headers = engine.calls[0]?.metadata;
    expect(headers?.['x-api-key']).toBe('dev-key');
    expect(headers?.authorization).toBe('Bearer dev-key');

    const indexRequest = engine.calls.find((call) => call.method === 'indexEntity')?.request;
    expect(indexRequest?.entityId).toBe('1001');
    expect(indexRequest?.tenantId).toBe('acme');
    expect(indexRequest?.price).toBe(1500);
    expect(indexRequest?.categories).toEqual(
      expect.arrayContaining(['feature:pool', 'amenities:parking']),
    );

    const searchRequest = engine.calls.find((call) => call.method === 'search')?.request;
    expect(searchRequest?.tenantId).toBe('acme');
    expect(searchRequest?.limit).toBe(50);
    const filters = (searchRequest?.filters as Array<{ op: number; attribute: string }>) ?? [];
    expect(filters[0]).toEqual({ op: FilterOperation.MUST, attribute: 'feature:pool' });
    expect(filters.some((filter) => filter.attribute === 'category:villa')).toBe(true);
    expect(filters.some((filter) => filter.attribute.startsWith('geo:'))).toBe(true);
  });

  it('accepts plain SearchRequestOptions for search', async () => {
    const engine = await startMockEngine({ searchIds: ['7'] });
    engines.push(engine);

    const client = PulseIndexClient.create(`127.0.0.1:${engine.port}`, 'k');
    clients.push(client);

    const result = await client.search({
      tenantId: 't1',
      must: 'feature:pool',
      limit: 10,
    });

    expect(result.matchedEntityIds).toEqual(['7']);
    const searchRequest = engine.calls.find((call) => call.method === 'search')?.request;
    expect(searchRequest?.tenantId).toBe('t1');
    expect(searchRequest?.limit).toBe(10);
  });

  it('wraps unauthenticated gRPC status as PulseIndexAuthError', async () => {
    const engine = await startMockEngine({ failAuth: true });
    engines.push(engine);

    const client = new PulseIndexClient({
      endpoint: `127.0.0.1:${engine.port}`,
      apiKey: 'bad',
      timeoutMs: 2000,
    });
    clients.push(client);

    await expect(client.index('1', { categories: ['x'] })).rejects.toBeInstanceOf(PulseIndexAuthError);
  });

  it('reports unhealthy while the engine is in degraded recovery', async () => {
    // The engine publishes degraded recovery on grpc.health.v1 by flipping the
    // status to NOT_SERVING, so the SDK learns it without any credential.
    const engine = await startMockEngine({ servingStatus: 2 });
    engines.push(engine);
    const client = new PulseIndexClient({ endpoint: `127.0.0.1:${engine.port}`, apiKey: 'dev-key' });
    clients.push(client);

    expect(await client.servingStatus()).toBe(2);
    expect(await client.health()).toBe(false);
  });

  it('reports healthy when the engine is reachable and serving', async () => {
    const engine = await startMockEngine({ servingStatus: 1 });
    engines.push(engine);
    const client = new PulseIndexClient({ endpoint: `127.0.0.1:${engine.port}`, apiKey: 'dev-key' });
    clients.push(client);

    expect(await client.health()).toBe(true);
  });

  it('stays healthy when the key may not call GetRecoveryState', async () => {
    // The regression this method was rewritten for. GetRecoveryState requires
    // the `admin` scope and the engine refuses `admin` to every tenant-bound
    // key, so health() built on it returned false for every customer, always,
    // no matter how healthy the engine was.
    const engine = await startMockEngine({ servingStatus: 1, denyRecoveryState: true });
    engines.push(engine);
    const client = new PulseIndexClient({ endpoint: `127.0.0.1:${engine.port}`, apiKey: 'dev-key' });
    clients.push(client);

    await expect(client.getRecoveryState()).rejects.toBeTruthy();
    expect(await client.health()).toBe(true);
  });

  it('reports unhealthy against an engine with no health service', async () => {
    // An engine predating this contract answers UNIMPLEMENTED. Reporting false
    // is the honest answer: the SDK cannot tell whether it is serving.
    const engine = await startMockEngine({ omitHealthService: true });
    engines.push(engine);
    const client = new PulseIndexClient({ endpoint: `127.0.0.1:${engine.port}`, apiKey: 'dev-key' });
    clients.push(client);

    expect(await client.health()).toBe(false);
  });

  it('reports unhealthy when the engine is unreachable', async () => {
    const client = new PulseIndexClient({
      endpoint: '127.0.0.1:1',
      apiKey: 'dev-key',
      timeoutMs: 500,
    });
    clients.push(client);
    expect(await client.health()).toBe(false);
  });
});
