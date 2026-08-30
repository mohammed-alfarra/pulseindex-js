import { GeoHash } from '../geo/GeoHash';
import { PulseIndexQueryError } from '../errors/PulseIndexError';
import {
  UINT32_MAX,
  type EncodedEntity,
  type EntityAttributes,
  type EntityId,
  type EntityInput,
} from '../types';

const SKIP_ATTRIBUTE_KEYS = new Set([
  'id',
  'entityId',
  'entity_id',
  'attributes',
  'price',
  'locationPrefix',
  'location_prefix',
  'tenantId',
  'tenant_id',
  'latitude',
  'longitude',
  'lat',
  'lng',
  'lon',
  'categories',
  'tags',
]);

export function toUint64String(value: EntityId, field = 'entityId'): string {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new PulseIndexQueryError(`${field} must be a non-negative integer.`);
    }
    return value.toString(10);
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
      throw new PulseIndexQueryError(
        `${field} must be a non-negative safe integer, bigint, or digit string.`,
      );
    }
    return String(value);
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new PulseIndexQueryError(`${field} must be a non-negative integer string.`);
  }
  return trimmed.replace(/^0+(?=\d)/, '');
}

export function toUint32(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > UINT32_MAX) {
    throw new PulseIndexQueryError(`${field} must be an integer between 0 and ${UINT32_MAX}.`);
  }
  return Math.floor(numeric);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pushScalarTag(target: string[], value: unknown): void {
  if (typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    const text = String(value).trim();
    if (text.length > 0) {
      target.push(text);
    }
  }
}

function flattenAttributes(attributes: Record<string, unknown>): string[] {
  const categories: string[] = [];

  for (const listKey of ['categories', 'tags'] as const) {
    const list = attributes[listKey];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      pushScalarTag(categories, item);
    }
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (SKIP_ATTRIBUTE_KEYS.has(key)) {
      continue;
    }

    if (typeof value === 'boolean') {
      if (value) {
        categories.push(key);
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'boolean') {
          if (item) {
            categories.push(`${key}:true`);
          }
          continue;
        }
        if (item !== undefined && item !== null && item !== '') {
          categories.push(`${key}:${String(item)}`);
        }
      }
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        categories.push(`${key}:${String(value)}`);
      }
    }
  }

  const lat = firstNumber(attributes, ['latitude', 'lat']);
  const lon = firstNumber(attributes, ['longitude', 'lng', 'lon']);
  if (lat !== undefined && lon !== undefined) {
    categories.push(...GeoHash.encodeMultiTags(lat, lon));
  }

  return [...new Set(categories)];
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function encodeEntity(
  entityIdOrInput: EntityId | EntityInput,
  attributes: EntityAttributes = {},
  defaults: { tenantId?: string } = {},
): EncodedEntity {
  const isObjectInput =
    typeof entityIdOrInput === 'object' && entityIdOrInput !== null && !Array.isArray(entityIdOrInput);

  const input = isObjectInput ? (entityIdOrInput as EntityInput) : {};
  const nested = asRecord(input.attributes);
  const merged: Record<string, unknown> = {
    ...input,
    ...nested,
    ...attributes,
  };

  const rawId =
    (!isObjectInput ? entityIdOrInput : undefined) ??
    input.id ??
    input.entityId ??
    input.entity_id ??
    nested.id ??
    nested.entityId ??
    nested.entity_id;

  if (rawId === undefined || rawId === null || rawId === '') {
    throw new PulseIndexQueryError('entityId is required.');
  }

  const tenantId =
    firstString(merged, ['tenantId', 'tenant_id']) ?? defaults.tenantId ?? '';

  return {
    entityId: toUint64String(rawId as EntityId, 'entityId'),
    categories: flattenAttributes(merged),
    price: toUint32(merged.price, 'price'),
    locationPrefix: toUint64String(
      (merged.locationPrefix ?? merged.location_prefix ?? 0) as EntityId,
      'locationPrefix',
    ),
    tenantId,
  };
}
