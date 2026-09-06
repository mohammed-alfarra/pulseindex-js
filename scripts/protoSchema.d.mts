export interface ProtoSchema {
  rpcs: string[];
  messages: Record<string, string[]>;
  enums: Record<string, string[]>;
}
export function parseProtoSchema(text: string): ProtoSchema;
export function diffProtoSchemas(expected: ProtoSchema, actual: ProtoSchema): string[];

/**
 * Differences that matter between the engine's proto and the vendored copy.
 *
 * Omissions are reported unless they are in the deliberately-omitted lists:
 * the vendored copy leaves the operator RPCs out on purpose, and anything else
 * missing is an RPC nobody remembered to vendor.
 */
export function diffProtoSubset(engine: ProtoSchema, vendored: ProtoSchema): string[];

export const DELIBERATELY_OMITTED_RPCS: string[];
export const DELIBERATELY_OMITTED_MESSAGES: string[];
