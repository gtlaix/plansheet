import proj4 from 'proj4';

/**
 * British National Grid (EPSG:27700, OSGB36) → WGS84 lat/lng.
 *
 * Uses proj4 with the standard 7-parameter Helmert transform, which is accurate
 * to ~1 m across Great Britain — ample for locating a site (the definitive
 * OSTN15 grid-shift would add cm-level precision we don't need here).
 */
const OSGB36_BNG =
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
  '+ellps=airy +units=m +no_defs ' +
  '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489';

/** Valid extent of the National Grid (metres). */
export const BNG_MAX_EASTING = 700000;
export const BNG_MAX_NORTHING = 1300000;

export function isValidBng(easting: number, northing: number): boolean {
  return (
    Number.isFinite(easting) &&
    Number.isFinite(northing) &&
    easting >= 0 &&
    easting <= BNG_MAX_EASTING &&
    northing >= 0 &&
    northing <= BNG_MAX_NORTHING
  );
}

/** Convert a BNG easting/northing (metres) to WGS84 decimal degrees. */
export function bngToWgs84(easting: number, northing: number): { lat: number; lng: number } {
  const [lng, lat] = proj4(OSGB36_BNG, 'WGS84', [easting, northing]);
  return { lat, lng };
}
