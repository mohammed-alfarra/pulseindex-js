export class GeoHash {
  static readonly TAG_PREFIX = 'geo:';
  static readonly MIN_PRECISION = 1;
  static readonly MAX_PRECISION = 12;
  static readonly INDEX_PRECISIONS = [5, 6] as const;

  private static readonly BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  private static readonly EARTH_RADIUS_KM = 6371.0;
  /**
   * Most cells one radius query may expand into, and therefore the most SHOULD
   * predicates it sends.
   *
   * This used to be 64 and it was a truncation limit: the walk stopped mid
   * covering and returned what it had, so a 50 km search covered 18% of its own
   * circle and said nothing. It is now a budget the precision is chosen to fit,
   * so a covering is always complete or the request is refused.
   *
   * 512 against the engine's 4,096-filter ceiling. Supports radii to about
   * 60 km at the coarsest indexed precision; past that the request is refused.
   */
  static readonly COVERING_CELL_BUDGET = 512;

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

  /**
   * The precision a radius query should cover at, at this point on the globe.
   *
   * Only ever one of {@link INDEX_PRECISIONS}. That is the correction: this
   * used to return 4 for anything over 8 km, and nothing is indexed at
   * precision 4, so **every radius above 8 km matched nothing at all**.
   * Measured against a real engine with entities tagged by `encodeMultiTags`:
   * 15 km returned 0 of 386, 50 km returned 0 of 4,282 — an empty page, with
   * no error to explain it.
   *
   * Of the indexed precisions it returns the finest whose complete covering
   * fits {@link COVERING_CELL_BUDGET}, because a finer cell wastes less area
   * outside the circle. Measured at Riyadh: 5 km takes 140 cells at precision
   * 6 for 1.21x the circle, against 10 cells at precision 5 for 2.76x; 15 km
   * needs 1,120 at precision 6 and so falls to 47 at precision 5 for 1.44x.
   *
   * Latitude is a parameter because it changes the answer: a cell keeps its
   * width in degrees, so it narrows in kilometres toward the poles and the same
   * radius needs more of them.
   *
   * @throws when no indexed precision can cover the radius within the budget —
   *         refused rather than half-covered.
   */
  static optimalPrecisionForRadius(radiusKm: number, lat = 0, lon = 0): number {
    if (radiusKm < 0) {
      throw new Error('Radius must be non-negative.');
    }

    const budget = this.COVERING_CELL_BUDGET;
    // Finest first: a smaller cell wastes less area outside the circle.
    for (const precision of [...this.INDEX_PRECISIONS].sort((a, b) => b - a)) {
      // One past the budget is enough to know it does not fit, and stops a
      // 100 km radius walking sixteen hundred cells to find out.
      if (this.walkCovering(lat, lon, radiusKm, precision, budget + 1).length <= budget) {
        return precision;
      }
    }

    throw new Error(
      `A ${radiusKm} km radius needs more than ${budget} geohash cells at every indexed ` +
        `precision (${this.INDEX_PRECISIONS.join(', ')}). Use a smaller radius, or index a ` +
        'coarser precision.',
    );
  }

  static precisionForRadius(radiusKm: number, lat = 0, lon = 0): number {
    return this.optimalPrecisionForRadius(radiusKm, lat, lon);
  }

  /**
   * GeoHashes whose cells cover the search circle.
   *
   * The covering is always complete. It used to stop at 64 cells and return
   * what it had, so a caller asking for 50 km got cells covering 18% of that
   * circle — with no error. Now the precision is chosen to fit the budget and
   * the walk always finishes, so the result either covers the circle or the
   * call refuses.
   *
   * Passing `precision` explicitly overrides the choice, and is checked against
   * {@link INDEX_PRECISIONS}: entities carry tags only at those, so any other
   * precision matches nothing at all rather than matching loosely.
   */
  static getCoveringHashes(
    lat: number,
    lon: number,
    radiusKm: number,
    precision?: number,
  ): string[] {
    if (radiusKm < 0) {
      throw new Error('Radius must be non-negative.');
    }

    let resolved: number;
    if (precision === undefined) {
      resolved = this.optimalPrecisionForRadius(radiusKm, lat, lon);
    } else {
      this.assertPrecision(precision);
      if (!(this.INDEX_PRECISIONS as readonly number[]).includes(precision)) {
        throw new Error(
          `Precision ${precision} is not indexed, so a covering at it matches nothing. ` +
            `Indexed precisions: ${this.INDEX_PRECISIONS.join(', ')}.`,
        );
      }
      resolved = precision;
    }

    return this.walkCovering(lat, lon, radiusKm, resolved, null);
  }

  /**
   * Every cell at `precision` that intersects the circle, breadth-first from
   * the centre and expanding only through cells that intersect.
   *
   * `limit` exists only so the precision chooser can stop early once a
   * precision is known not to fit; a null limit walks to completion, which is
   * what every caller that wants an answer passes.
   */
  private static walkCovering(
    lat: number,
    lon: number,
    radiusKm: number,
    precision: number,
    limit: number | null,
  ): string[] {
    const covering: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [this.encode(lat, lon, precision)];

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
      if (limit !== null && covering.length >= limit) {
        return covering;
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
