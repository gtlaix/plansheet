import type { LocationSelection } from '../types';

const POSTCODES_BASE = 'https://api.postcodes.io';

export class GeocodeError extends Error {}

interface PostcodesResult {
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  admin_district?: string;
  /** Metres from the query point; present on reverse (lon/lat) lookups. */
  distance?: number;
}

/** Beyond this, the "nearest postcode" is misleading in rural areas (ISSUES-6). */
const REVERSE_MAX_DISTANCE_M = 200;

/** Forward-geocode a UK postcode via postcodes.io. Throws GeocodeError with a user-facing message. */
export async function geocodePostcode(
  postcode: string,
  fetchFn: typeof fetch = fetch,
): Promise<LocationSelection> {
  const trimmed = postcode.trim();
  if (trimmed === '') throw new GeocodeError('Enter a postcode.');
  const res = await fetchFn(`${POSTCODES_BASE}/postcodes/${encodeURIComponent(trimmed)}`);
  if (res.status === 404) throw new GeocodeError(`"${trimmed}" is not a recognised UK postcode.`);
  if (!res.ok) throw new GeocodeError('Postcode lookup failed — please try again.');
  const body = (await res.json()) as { result: PostcodesResult };
  const { latitude, longitude, postcode: canonical } = body.result;
  if (latitude == null || longitude == null) {
    throw new GeocodeError(`No coordinates are available for ${canonical}.`);
  }
  return { lat: latitude, lng: longitude, label: canonical };
}

/** Nearest postcode to a point (for the report header). Best-effort — returns null on any failure. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(`${POSTCODES_BASE}/postcodes?lon=${lng}&lat=${lat}&limit=1`);
    if (!res.ok) return null;
    const body = (await res.json()) as { result: PostcodesResult[] | null };
    const nearest = body.result?.[0];
    if (!nearest) return null;
    if (typeof nearest.distance === 'number' && nearest.distance > REVERSE_MAX_DISTANCE_M) return null;
    return nearest.postcode;
  } catch {
    return null;
  }
}
