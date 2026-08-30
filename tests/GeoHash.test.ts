import { describe, expect, it } from 'vitest';
import { GeoHash } from '../src';

describe('GeoHash', () => {
  it('encodes well-known coordinates', () => {
    expect(GeoHash.encode(42.6, -5.6, 5)).toBe('ezs42');
    expect(GeoHash.encode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(GeoHash.encode(37.7749, -122.4194, 6)).toBe('9q8yyk');
  });

  it('decodes a cell centre within precision', () => {
    const decoded = GeoHash.decode('ezs42');
    expect(decoded.lat).toBeCloseTo(42.6, 1);
    expect(decoded.lon).toBeCloseTo(-5.6, 1);
  });

  it('round-trips encode and decode', () => {
    const lat = 24.7136;
    const lon = 46.6753;
    const decoded = GeoHash.decode(GeoHash.encode(lat, lon, 8));
    expect(decoded.lat).toBeCloseTo(lat, 2);
    expect(decoded.lon).toBeCloseTo(lon, 2);
  });

  it('returns the eight neighbors of ezs42', () => {
    expect(GeoHash.neighbors('ezs42')).toEqual([
      'ezs48',
      'ezs49',
      'ezs43',
      'ezs41',
      'ezs40',
      'ezefp',
      'ezefr',
      'ezefx',
    ]);
  });

  it('resolves cardinal neighbors', () => {
    expect(GeoHash.neighbor('ezs42', 'n')).toBe('ezs48');
    expect(GeoHash.neighbor('ezs42', 'e')).toBe('ezs43');
    expect(GeoHash.neighbor('ezs42', 's')).toBe('ezs40');
    expect(GeoHash.neighbor('ezs42', 'w')).toBe('ezefr');
  });

  it('builds a 3x3 neighborhood of center plus eight neighbors', () => {
    const grid = GeoHash.neighborhood3x3('ezs42');
    expect(grid).toHaveLength(9);
    expect(grid[0]).toBe('ezs42');
    expect(grid.slice(1)).toEqual(GeoHash.neighbors('ezs42'));
    expect(GeoHash.neighborhoodTags(42.6, -5.6, 5)[0]).toBe('geo:5:ezs42');
  });

  it('maps radius to dynamic precision', () => {
    expect(GeoHash.optimalPrecisionForRadius(0.0)).toBe(6);
    expect(GeoHash.optimalPrecisionForRadius(1.0)).toBe(6);
    expect(GeoHash.optimalPrecisionForRadius(1.5)).toBe(6);
    expect(GeoHash.optimalPrecisionForRadius(1.51)).toBe(5);
    expect(GeoHash.optimalPrecisionForRadius(4.9)).toBe(5);
    expect(GeoHash.optimalPrecisionForRadius(8.0)).toBe(5);
    expect(GeoHash.optimalPrecisionForRadius(8.01)).toBe(4);
    expect(GeoHash.optimalPrecisionForRadius(40.0)).toBe(4);
    expect(GeoHash.precisionForRadius(4.9)).toBe(GeoHash.optimalPrecisionForRadius(4.9));
  });

  it('covers a radius with the centre cell first', () => {
    const hashes = GeoHash.getCoveringHashes(42.6, -5.6, 4.9);
    expect(hashes[0]).toBe('ezs42');
    expect(hashes.length).toBeGreaterThanOrEqual(1);
    expect(hashes).toEqual([...new Set(hashes)]);
    for (const hash of hashes) {
      expect(hash).toHaveLength(5);
    }
  });

  it('uses precision 6 for a 1.2km radius', () => {
    const hashes = GeoHash.getCoveringHashes(37.7749, -122.4194, 1.2);
    expect(hashes[0]).toBe('9q8yyk');
    for (const hash of hashes) {
      expect(hash).toHaveLength(6);
    }
  });

  it('drops neighbors that miss a tiny circle', () => {
    const bounds = GeoHash.decodeBounds('ezs42');
    const lat = (bounds.latMin + bounds.latMax) / 2.0;
    const lon = (bounds.lonMin + bounds.lonMax) / 2.0;
    const hashes = GeoHash.getCoveringHashes(lat, lon, 0.05, 5);

    expect(hashes).toEqual(['ezs42']);
    expect(hashes).not.toContain('ezs48');
  });

  it('honors explicit covering precision', () => {
    const hashes = GeoHash.getCoveringHashes(42.6, -5.6, 1.0, 5);
    expect(hashes[0]).toBe('ezs42');
    for (const hash of hashes) {
      expect(hash).toHaveLength(5);
    }
  });

  it('namespaces tags by precision and is idempotent', () => {
    expect(GeoHash.tag('ezs42')).toBe('geo:5:ezs42');
    expect(GeoHash.tag('geo:ezs42')).toBe('geo:5:ezs42');
    expect(GeoHash.tag('geo:5:ezs42')).toBe('geo:5:ezs42');
    expect(GeoHash.encodeTag(42.6, -5.6, 5)).toBe('geo:5:ezs42');
    expect(GeoHash.encodeTag(42.6, -5.6, 6)).toBe(`geo:6:${GeoHash.encode(42.6, -5.6, 6)}`);
  });

  it('indexes dual-granularity geo tags', () => {
    const lat = 42.6;
    const lon = -5.6;
    const tags = GeoHash.encodeMultiTags(lat, lon);
    expect(tags).toEqual([
      `geo:5:${GeoHash.encode(lat, lon, 5)}`,
      `geo:6:${GeoHash.encode(lat, lon, 6)}`,
    ]);
    expect(tags[0]).toBe('geo:5:ezs42');
    expect(tags[1]?.startsWith('geo:6:')).toBe(true);
    expect(tags[1]?.slice('geo:6:'.length)).toHaveLength(6);
  });

  it('computes bounding-box radius math via haversine', () => {
    const km = GeoHash.haversineKm(41.0082, 28.9784, 41.0082, 28.9784);
    expect(km).toBeCloseTo(0, 6);
    expect(GeoHash.haversineKm(41.0082, 28.9784, 41.0532, 28.9784)).toBeGreaterThan(4);
    expect(GeoHash.haversineKm(41.0082, 28.9784, 41.0532, 28.9784)).toBeLessThan(6);
  });

  it('rejects invalid inputs', () => {
    expect(() => GeoHash.encode(91.0, 0.0, 5)).toThrow(/Latitude/);
    expect(() => GeoHash.encode(0.0, 200.0, 5)).toThrow(/Longitude/);
    expect(() => GeoHash.optimalPrecisionForRadius(-1)).toThrow(/Radius/);
    expect(() => GeoHash.neighbor('ezs42', 'up')).toThrow(/Direction/);
  });
});
