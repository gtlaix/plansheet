/**
 * Pure geometry helpers for the site-boundary features (SPEC-01, and the
 * foundation for SPEC-02/04). No Leaflet, no DOM, no network — everything here
 * is unit-testable in isolation.
 *
 * Conventions: geometries are GeoJSON `Polygon`/`MultiPolygon` with coordinates
 * in `[lng, lat]` (WGS84 decimal degrees), matching what the map, the Planning
 * Data API and geoman all use.
 */

export type AreaGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** WKT sent as a GET query param must stay well under typical URL limits. */
export const MAX_QUERY_WKT_CHARS = 1800;

/** Coordinates rounded to 6 dp (~0.1 m) — plenty for a planning boundary. */
const QUERY_DP = 6;

/** Rough England envelope used to sanity-check imported boundaries. */
export const ENGLAND_BBOX = { minLng: -7, minLat: 49, maxLng: 2, maxLat: 56 };

/** Thrown by {@link parseBoundary} with a message safe to show the user. */
export class BoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundaryError';
  }
}

// --- WKT serialisation -------------------------------------------------------

function round(n: number, dp = QUERY_DP): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function ringToWkt(ring: GeoJSON.Position[]): string {
  return '(' + ring.map(([lng, lat]) => `${round(lng)} ${round(lat)}`).join(', ') + ')';
}

function polygonRingsToWkt(rings: GeoJSON.Position[][]): string {
  return '(' + rings.map(ringToWkt).join(', ') + ')';
}

/** Serialise a Polygon/MultiPolygon to a WKT string with 6-dp coordinates. */
export function toWkt(geom: AreaGeometry): string {
  if (geom.type === 'Polygon') {
    return `POLYGON ${polygonRingsToWkt(geom.coordinates)}`;
  }
  return `MULTIPOLYGON (${geom.coordinates.map(polygonRingsToWkt).join(', ')})`;
}

// --- Douglas–Peucker simplification -----------------------------------------

function perpendicularDistance(p: GeoJSON.Position, a: GeoJSON.Position, b: GeoJSON.Position): number {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Classic Douglas–Peucker on an open polyline. Endpoints are always kept. */
function simplifyLine(points: GeoJSON.Position[], tolerance: number): GeoJSON.Position[] {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyLine(points.slice(0, index + 1), tolerance);
    const right = simplifyLine(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/**
 * Simplify a *closed* ring while keeping it closed. Douglas–Peucker needs two
 * fixed anchors; on a ring the start and end coincide, so we anchor at the
 * point farthest from the ring's start and simplify the two halves.
 */
function simplifyRing(ring: GeoJSON.Position[], tolerance: number): GeoJSON.Position[] {
  const open = ring.slice(0, -1); // drop the duplicated closing vertex
  if (open.length <= 3) return ring.slice(); // triangles are already minimal

  let farIndex = 0;
  let farDist = -1;
  const start = open[0];
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - start[0], open[i][1] - start[1]);
    if (d > farDist) {
      farDist = d;
      farIndex = i;
    }
  }

  const firstHalf = simplifyLine(open.slice(0, farIndex + 1), tolerance);
  const secondHalf = simplifyLine(open.slice(farIndex).concat([open[0]]), tolerance);
  const result = firstHalf.slice(0, -1).concat(secondHalf); // already closed (ends at start)
  // A ring needs at least 4 positions (3 distinct + closure); if over-simplified
  // fall back to the original so we never emit a degenerate ring.
  return result.length >= 4 ? result : ring.slice();
}

function simplifyGeometry(geom: AreaGeometry, tolerance: number): AreaGeometry {
  const simplifyPolygon = (rings: GeoJSON.Position[][]) => rings.map((r) => simplifyRing(r, tolerance));
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: simplifyPolygon(geom.coordinates) };
  }
  return { type: 'MultiPolygon', coordinates: geom.coordinates.map(simplifyPolygon) };
}

/**
 * WKT for a geometry query, simplified just enough to fit `maxChars`. The
 * original geometry is untouched — only the query string is coarsened — so the
 * displayed boundary and area maths keep full precision. Tolerance climbs
 * geometrically until the WKT fits (or a sane iteration cap is hit).
 */
export function wktForQuery(geom: AreaGeometry, maxChars = MAX_QUERY_WKT_CHARS): string {
  let wkt = toWkt(geom);
  if (wkt.length <= maxChars) return wkt;
  let tolerance = 0.000005; // ~0.5 m in degrees
  let current = geom;
  for (let i = 0; i < 40 && wkt.length > maxChars; i++) {
    current = simplifyGeometry(current, tolerance);
    wkt = toWkt(current);
    tolerance *= 1.6;
  }
  return wkt;
}

// --- Area & bounds -----------------------------------------------------------

const EARTH_RADIUS_M = 6378137;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Signed spherical area of a single closed ring, in m². */
function ringAreaM2(ring: GeoJSON.Position[]): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

function polygonAreaM2(rings: GeoJSON.Position[][]): number {
  if (rings.length === 0) return 0;
  // Exterior minus holes (interior rings). Use absolute values so winding order
  // doesn't matter for imported geometry.
  const exterior = Math.abs(ringAreaM2(rings[0]));
  const holes = rings.slice(1).reduce((sum, r) => sum + Math.abs(ringAreaM2(r)), 0);
  return Math.max(0, exterior - holes);
}

/** Area of a Polygon/MultiPolygon in square metres (spherical approximation). */
export function areaM2(geom: AreaGeometry): number {
  if (geom.type === 'Polygon') return polygonAreaM2(geom.coordinates);
  return geom.coordinates.reduce((sum, poly) => sum + polygonAreaM2(poly), 0);
}

/** Format an area as a compact "1,234 m² (0.12 ha)" string. */
export function formatArea(m2: number): string {
  const sqm = Math.round(m2).toLocaleString('en-GB');
  const ha = (m2 / 10000).toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return `${sqm} m² (${ha} ha)`;
}

function eachRing(geom: AreaGeometry): GeoJSON.Position[][] {
  return geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
}

/** [minLng, minLat, maxLng, maxLat] bounding box of a geometry. */
export function bbox(geom: AreaGeometry): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of eachRing(geom)) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Bounding-box centre — a stable representative point for the pin/share link. */
export function center(geom: AreaGeometry): { lat: number; lng: number } {
  const [minLng, minLat, maxLng, maxLat] = bbox(geom);
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

// --- Parsing & validation (import: story 3) ----------------------------------

/** Ensure a ring is closed (first position repeated at the end). */
function closeRing(ring: GeoJSON.Position[]): GeoJSON.Position[] {
  if (ring.length === 0) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

function normalisePolygon(rings: GeoJSON.Position[][]): GeoJSON.Position[][] {
  return rings.map(closeRing);
}

/**
 * Validate a parsed geometry and throw a user-facing {@link BoundaryError} on
 * anything wrong: too few points, coordinates that look like easting/northing
 * (EPSG:27700), or a boundary outside England / with lat & lng swapped.
 */
function validateBoundary(geom: AreaGeometry): AreaGeometry {
  const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  if (polygons.length === 0 || polygons[0].length === 0) {
    throw new BoundaryError('No polygon found in the boundary.');
  }
  for (const rings of polygons) {
    for (const ring of rings) {
      if (ring.length < 4) {
        throw new BoundaryError('A boundary ring needs at least 3 distinct corners.');
      }
      for (const pos of ring) {
        const [lng, lat] = pos;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          throw new BoundaryError('The boundary contains non-numeric coordinates.');
        }
        if (Math.abs(lng) > 1000 || Math.abs(lat) > 1000) {
          throw new BoundaryError(
            'These look like easting/northing values (EPSG:27700). Reproject the boundary to WGS84 longitude/latitude first.',
          );
        }
      }
    }
  }
  const [minLng, minLat, maxLng, maxLat] = bbox(geom);
  if (
    maxLng < ENGLAND_BBOX.minLng ||
    minLng > ENGLAND_BBOX.maxLng ||
    maxLat < ENGLAND_BBOX.minLat ||
    minLat > ENGLAND_BBOX.maxLat
  ) {
    throw new BoundaryError(
      'The boundary is outside England. Check the coordinates are WGS84 in longitude, latitude order.',
    );
  }
  return geom;
}

function geometryFromGeoJson(obj: unknown): AreaGeometry {
  const o = obj as { type?: string; geometry?: unknown; features?: unknown[]; coordinates?: unknown };
  if (!o || typeof o !== 'object' || !o.type) {
    throw new BoundaryError('That is not valid GeoJSON.');
  }
  if (o.type === 'FeatureCollection') {
    const features = Array.isArray(o.features) ? o.features : [];
    for (const f of features) {
      const g = (f as { geometry?: { type?: string } })?.geometry;
      if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) return geometryFromGeoJson(g);
    }
    throw new BoundaryError('No polygon feature found in the GeoJSON.');
  }
  if (o.type === 'Feature') return geometryFromGeoJson(o.geometry);
  if (o.type === 'Polygon' || o.type === 'MultiPolygon') {
    return o as unknown as AreaGeometry;
  }
  throw new BoundaryError(`GeoJSON geometry must be a Polygon or MultiPolygon (got ${o.type}).`);
}

// WKT parsing: read one parenthesised group's content into nested arrays,
// bottoming out at "x y, x y" coordinate lists.
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseCoordList(s: string): GeoJSON.Position[] {
  return splitTopLevel(s).map((pair) => {
    const nums = pair.trim().split(/\s+/).map(Number);
    return [nums[0], nums[1]] as GeoJSON.Position;
  });
}

function stripOuterParens(s: string): string {
  const t = s.trim();
  return t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1) : t;
}

function parseRings(s: string): GeoJSON.Position[][] {
  // content is "(ring), (ring)" — split into rings, parse each
  return splitTopLevel(stripOuterParens(`(${s})`)).map((ring) => parseCoordList(stripOuterParens(ring)));
}

function geometryFromWkt(input: string): AreaGeometry {
  const m = /^\s*(MULTIPOLYGON|POLYGON)\s*(\(.*\))\s*$/is.exec(input);
  if (!m) {
    throw new BoundaryError('Could not read that as GeoJSON or a WKT POLYGON/MULTIPOLYGON.');
  }
  const [, kind, body] = m;
  const inner = stripOuterParens(body);
  if (kind.toUpperCase() === 'POLYGON') {
    return { type: 'Polygon', coordinates: parseRings(inner) };
  }
  // MULTIPOLYGON: "( (rings), (rings) )" — each top-level group is one polygon
  const polygons = splitTopLevel(inner).map((poly) => parseRings(stripOuterParens(poly)));
  return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * Parse a pasted/uploaded boundary. Accepts GeoJSON (Feature, FeatureCollection
 * or bare Polygon/MultiPolygon geometry) or WKT (`POLYGON`/`MULTIPOLYGON`),
 * closes rings, and validates it looks like a WGS84 boundary in England.
 * Throws {@link BoundaryError} with a user-facing message on any problem.
 */
export function parseBoundary(input: string): AreaGeometry {
  const trimmed = input.trim();
  if (trimmed === '') throw new BoundaryError('Paste a boundary as GeoJSON or WKT first.');

  let geom: AreaGeometry;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BoundaryError('That looks like GeoJSON but is not valid JSON.');
    }
    geom = geometryFromGeoJson(parsed);
  } else {
    geom = geometryFromWkt(trimmed);
  }

  const normalised: AreaGeometry =
    geom.type === 'Polygon'
      ? { type: 'Polygon', coordinates: normalisePolygon(geom.coordinates) }
      : { type: 'MultiPolygon', coordinates: geom.coordinates.map(normalisePolygon) };

  return validateBoundary(normalised);
}
