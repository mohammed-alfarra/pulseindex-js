export interface ProtoSchema {
  rpcs: string[];
  messages: Record<string, string[]>;
  enums: Record<string, string[]>;
}
export function parseProtoSchema(text: string): ProtoSchema;
export function diffProtoSchemas(expected: ProtoSchema, actual: ProtoSchema): string[];
