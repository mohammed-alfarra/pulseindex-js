import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProtoSchema, type ProtoSchema } from '../scripts/protoSchema.mjs';

/**
 * Guard against silent proto drift.
 *
 * The SDK loads `proto/engine.proto` at runtime and reads fields by name, with
 * `?? default` fallbacks throughout `PulseIndexClient`. That means a field the
 * engine renames, renumbers or removes does not fail loudly — it yields the
 * fallback, and the client reports plausible-looking wrong data. Exactly that
 * class of drift left `needs_full_reindex` unobserved while `health()` reported
 * a degraded engine as healthy.
 *
 * The fixture below is the schema this SDK is written against, in full. Any
 * change to the vendored proto fails here until the fixture is updated, which
 * puts the change in the pull-request diff where it can be reviewed rather than
 * absorbed silently.
 *
 * It does NOT prove the vendored copy matches the engine — nothing inside this
 * repository can, since the engine is a separate private repository. Use
 * `npm run check:proto` with the engine checked out for that.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(HERE, '..', 'proto', 'engine.proto');

const EXPECTED: ProtoSchema = {
  rpcs: [
    'IndexEntity(IndexEntityRequest) -> IndexEntityResponse',
    'BatchIndexEntities(BatchIndexEntitiesRequest) -> BatchIndexEntitiesResponse',
    'DeleteEntity(DeleteEntityRequest) -> DeleteEntityResponse',
    'Search(SearchQueryRequest) -> SearchQueryResponse',
    'CreateSnapshot(CreateSnapshotRequest) -> CreateSnapshotResponse',
    'GetRecoveryState(GetRecoveryStateRequest) -> GetRecoveryStateResponse',
    'SetCdcOffset(SetCdcOffsetRequest) -> SetCdcOffsetResponse',
  ],
  messages: {
    IndexEntityRequest: [
      '1:uint64 entity_id',
      '2:uint64 location_prefix',
      '3:uint32 price',
      '4:repeated string categories',
      '5:string tenant_id',
    ],
    IndexEntityResponse: ['1:bool success'],
    BatchIndexEntitiesRequest: ['1:repeated IndexEntityRequest entities'],
    BatchIndexEntitiesResponse: ['1:uint32 indexed_count'],
    DeleteEntityRequest: ['1:uint64 entity_id', '2:string tenant_id'],
    DeleteEntityResponse: ['1:bool success'],
    FilterPredicate: ['1:Operation op', '2:string attribute'],
    RangePredicate: ['1:string field', '2:uint32 min_val', '3:uint32 max_val'],
    SearchQueryRequest: [
      '1:uint64 location_prefix',
      '2:repeated FilterPredicate filters',
      '3:repeated RangePredicate ranges',
      '4:uint32 limit',
      '5:uint32 offset',
      '6:string tenant_id',
    ],
    SearchQueryResponse: [
      '1:repeated uint64 matched_entity_ids',
      '2:uint32 total_matches',
      '3:uint64 execution_time_us',
    ],
    CreateSnapshotRequest: [],
    CreateSnapshotResponse: ['1:bool success', '2:string path', '3:uint64 last_cdc_offset'],
    GetRecoveryStateRequest: [],
    GetRecoveryStateResponse: [
      '1:uint64 last_cdc_offset',
      '2:uint64 indexed_count',
      '3:uint32 chunk_count',
      '4:uint64 mutations_since_snapshot',
      '5:bool needs_full_reindex',
    ],
    SetCdcOffsetRequest: ['1:uint64 offset'],
    SetCdcOffsetResponse: ['1:bool success'],
  },
  enums: {
    'FilterPredicate.Operation': ['MUST=0', 'SHOULD=1', 'MUST_NOT=2'],
  },
};

describe('vendored engine.proto schema', () => {
  const actual = parseProtoSchema(readFileSync(PROTO_PATH, 'utf8'));

  it('declares exactly the RPCs this SDK implements', () => {
    expect(actual.rpcs).toEqual(EXPECTED.rpcs);
  });

  it('declares exactly the messages this SDK expects', () => {
    expect(Object.keys(actual.messages).sort()).toEqual(Object.keys(EXPECTED.messages).sort());
  });

  it('declares every field with the expected number and type', () => {
    // Per-message assertions so a failure names the message that drifted
    // instead of dumping the whole schema.
    for (const [message, fields] of Object.entries(EXPECTED.messages)) {
      expect(actual.messages[message], `message ${message} is missing`).toBeDefined();
      expect(actual.messages[message], `field drift in message ${message}`).toEqual(fields);
    }
  });

  it('declares the expected enum values', () => {
    expect(actual.enums).toEqual(EXPECTED.enums);
  });

  it('still carries the fields the client reads back', () => {
    // These are read by name in PulseIndexClient with `?? default` fallbacks,
    // so their removal or rename would be silent at runtime.
    const recovery = actual.messages.GetRecoveryStateResponse ?? [];
    for (const field of [
      '1:uint64 last_cdc_offset',
      '2:uint64 indexed_count',
      '3:uint32 chunk_count',
      '4:uint64 mutations_since_snapshot',
      '5:bool needs_full_reindex',
    ]) {
      expect(recovery, `GetRecoveryStateResponse lost ${field}`).toContain(field);
    }
  });
});
