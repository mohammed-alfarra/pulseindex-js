export class GeoHash {
  static readonly TAG_PREFIX = 'geo:';
  static readonly MIN_PRECISION = 1;
  static readonly MAX_PRECISION = 12;
  static readonly INDEX_PRECISIONS = [5, 6] as const;

  private static readonly BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  private static readonly EARTH_RADIUS_KM = 6371.0;
  private static readonly MAX_COVERING_CELLS = 64;

  private static readonly NEIGHBORS: Record<'n' | 's' | 'e' | 'w', [string, string]> = {
    n: ['p0r21436x8zb9dcf5h7kjnmqesgutwvy', 'bc01fg45238967deuvhjyznpkmstqrwx'],
    s: ['14365h7k9dcfesgujnmqp0r2twvyx8zb', '238967debc01fg45kmstqrwxuvhjyznp'],
    e: ['bc01fg45238967deuvhjyznpkmstqrwx', 'p0r21436x8zb9dcf5h7kjnmqesgutwvy'],
    w: ['238967debc01fg45kmstqrwxuvhjyznp', '14365h7k9dcfesgujnmqp0r2twvyx8zb'],
  };

  private static readonly BORDERS: Record<'n' | 's' | 'e' | 'w', [string, string]> = {
    n: ['prxz', 'bcfguvyz'],
    s: ['028b', '0145hjnp'],
    e: ['bcfguvyz', 'prxz'],
    w: ['0145hjnp', '028b'],
  };

  static encode(lat: number, lon: number, precision = 6): string {
    this.assertLatitude(lat);
    this.assertLongitude(lon);
    this.assertPrecision(precision);

    let latMin = -90.0;
    let latMax = 90.0;
    let lonMin = -180.0;
    let lonMax = 180.0;
    let hash = '';
    let bit = 0;
    let ch = 0;
    let even = true;

    while (hash.length < precision) {
      if (even) {
        const mid = (lonMin + lonMax) / 2.0;
        if (lon >= mid) {
          ch |= 1 << (4 - bit);
          lonMin = mid;
        } else {
          lonMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2.0;
        if (lat >= mid) {
          ch |= 1 << (4 - bit);
          latMin = mid;
        } else {
          latMax = mid;
        }
      }

      even = !even;

      if (bit < 4) {
        bit += 1;
      } else {
        hash += this.BASE32[ch];
        bit = 0;
        ch = 0;
      }
    }

    return hash;
  }

  static decode(hash: string): { lat: number; lon: number } {
    const bounds = this.decodeBounds(hash);
    return {
      lat: (bounds.latMin + bounds.latMax) / 2.0,
      lon: (bounds.lonMin + bounds.lonMax) / 2.0,
    };
  }

  static decodeBounds(hash: string): {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  } {
    const normalized = this.normalizeHash(hash);

    let latMin = -90.0;
    let latMax = 90.0;
    let lonMin = -180.0;
    let lonMax = 180.0;
    let even = true;

    for (const character of normalized) {
      const cd = this.BASE32.indexOf(character);
      if (cd < 0) {
        throw new Error(`Invalid GeoHash character "${character}".`);
      }

      for (let mask = 16; mask > 0; mask >>= 1) {
        if (even) {
          const mid = (lonMin + lonMax) / 2.0;
          if ((cd & mask) !== 0) {
            lonMin = mid;
          } else {
            lonMax = mid;
          }
        } else {
          const mid = (latMin + latMax) / 2.0;
          if ((cd & mask) !== 0) {
            latMin = mid;
          } else {
            latMax = mid;
          }
        }
        even = !even;
      }
    }

    return { latMin, latMax, lonMin, lonMax };
  }

  static neighbor(hash: string, direction: string): string {
    const normalizedDirection = direction.toLowerCase();
    if (!this.isCardinal(normalizedDirection)) {
      throw new Error('Direction must be one of: n, s, e, w.');
    }
    return this.adjacent(this.normalizeHash(hash), normalizedDirection);
  }

  static neighbors(hash: string): string[] {
    const normalized = this.normalizeHash(hash);
    const north = this.adjacent(normalized, 'n');
    const south = this.adjacent(normalized, 's');
    const east = this.adjacent(normalized, 'e');
    const west = this.adjacent(normalized, 'w');

    return [
      north,
      this.adjacent(north, 'e'),
      east,
      this.adjacent(south, 'e'),
      south,
      this.adjacent(south, 'w'),
      west,
      this.adjacent(north, 'w'),
    ];
  }

  static neighborhood3x3(hash: string): string[] {
    const center = this.normalizeHash(hash);
    return [center, ...this.neighbors(center)];
  }

  static neighborhoodTags(lat: number, lon: number, precision = 6): string[] {
    return this.neighborhood3x3(this.encode(lat, lon, precision)).map((cell) => this.tag(cell));
  }

  static optimalPrecisionForRadius(radiusKm: number): number {
    if (radiusKm < 0) {
      throw new Error('Radius must be non-negative.');
    }
    if (radiusKm <= 1.5) {
      return 6;
    }
    if (radiusKm <= 8.0) {
      return 5;
    }
    return 4;
  }

  static precisionForRadius(radiusKm: number): number {
    return this.optimalPrecisionForRadius(radiusKm);
  }

  static getCoveringHashes(
    lat: number,
    lon: number,
    radiusKm: number,
    precision?: number,
  ): string[] {
    if (radiusKm < 0) {
      throw new Error('Radius must be non-negative.');
    }

    const resolvedPrecision = precision ?? this.optimalPrecisionForRadius(radiusKm);
    this.assertPrecision(resolvedPrecision);

    const center = this.encode(lat, lon, resolvedPrecision);
    const covering: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [center];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (!this.cellIntersectsCircle(current, lat, lon, radiusKm)) {
        continue;
      }

      covering.push(current);
      if (covering.length >= this.MAX_COVERING_CELLS) {
        break;
      }

      for (const neighbor of this.neighbors(current)) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return covering;
  }

  static tag(geohash: string): string {
    const hash = this.normalizeHash(geohash);
    return `${this.TAG_PREFIX}${hash.length}:${hash}`;
  }

  static encodeTag(lat: number, lon: number, precision = 6): string {
    return this.tag(this.encode(lat, lon, precision));
  }

  static encodeMultiTags(lat: number, lon: number): string[] {
    return this.INDEX_PRECISIONS.map((precision) => this.encodeTag(lat, lon, precision));
  }

  static haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2.0) ** 2 +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * Math.sin(dLon / 2.0) ** 2;
    return 2.0 * this.EARTH_RADIUS_KM * Math.asin(Math.min(1.0, Math.sqrt(a)));
  }

  private static cellIntersectsCircle(
    hash: string,
    lat: number,
    lon: number,
    radiusKm: number,
  ): boolean {
    const bounds = this.decodeBounds(hash);
    const closestLat = Math.min(Math.max(lat, bounds.latMin), bounds.latMax);
    const closestLon = Math.min(Math.max(lon, bounds.lonMin), bounds.lonMax);
    return this.haversineKm(lat, lon, closestLat, closestLon) <= radiusKm;
  }

  private static adjacent(hash: string, direction: 'n' | 's' | 'e' | 'w'): string {
    if (hash.length === 0) {
      throw new Error('GeoHash must not be empty.');
    }

    const lastChar = hash[hash.length - 1] ?? '';
    const type = hash.length % 2;
    let parent = hash.slice(0, -1);
    const borders = this.BORDERS[direction][type] ?? '';

    if (parent.length > 0 && borders.includes(lastChar)) {
      parent = this.adjacent(parent, direction);
    }

    const neighborCharset = this.NEIGHBORS[direction][type] ?? '';
    const index = neighborCharset.indexOf(lastChar);
    if (index < 0) {
      throw new Error(`Invalid GeoHash character "${lastChar}".`);
    }

    return parent + (this.BASE32[index] ?? '');
  }

  private static normalizeHash(hash: string): string {
    let normalized = hash.trim().toLowerCase();
    if (normalized.startsWith(this.TAG_PREFIX)) {
      normalized = normalized.slice(this.TAG_PREFIX.length);
    }

    const tagged = normalized.match(/^([1-9]|1[0-2]):([0-9bcdefghjkmnpqrstuvwxyz]+)$/);
    if (tagged) {
      normalized = tagged[2] ?? '';
    }

    if (normalized.length === 0) {
      throw new Error('GeoHash must not be empty.');
    }

    for (const character of normalized) {
      if (!this.BASE32.includes(character)) {
        throw new Error(`Invalid GeoHash "${normalized}".`);
      }
    }

    return normalized;
  }

  private static assertLatitude(lat: number): void {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error('Latitude must be between -90 and 90.');
    }
  }

  private static assertLongitude(lon: number): void {
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error('Longitude must be between -180 and 180.');
    }
  }

  private static assertPrecision(precision: number): void {
    if (
      !Number.isInteger(precision) ||
      precision < this.MIN_PRECISION ||
      precision > this.MAX_PRECISION
    ) {
      throw new Error(
        `GeoHash precision must be between ${this.MIN_PRECISION} and ${this.MAX_PRECISION}.`,
      );
    }
  }

  private static isCardinal(direction: string): direction is 'n' | 's' | 'e' | 'w' {
    return direction === 'n' || direction === 's' || direction === 'e' || direction === 'w';
  }

  private static toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
