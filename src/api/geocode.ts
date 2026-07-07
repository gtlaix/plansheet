import type { LocationSelection } from '../types';

const POSTCODES_BASE = 'https://api.postcodes.io';
const OS_PLACES_UPRN = 'https://api.os.uk/search/places/v1/uprn';

export const OS_KEY_STORAGE = 'plansheet-os-api-key';

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

export function getOsApiKey(): string | null {
  try {
    return localStorage.getItem(OS_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setOsApiKey(key: string): void {
  try {
    if (key.trim() === '') localStorage.removeItem(OS_KEY_STORAGE);
    else localStorage.setItem(OS_KEY_STORAGE, key.trim());
  } catch {
    // storage unavailable — key just won't persist
  }
}

interface OsPlacesDpa {
  UPRN: string;
  ADDRESS: string;
  LAT: number;
  LNG: number;
}

/**
 * Resolve a UPRN to coordinates via the OS Places API. Requires the user's
 * own OS Data Hub API key (there is no keyless UPRN lookup service).
 */
export async function lookupUprn(
  uprn: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<LocationSelection> {
  const trimmed = uprn.trim();
  if (!/^\d{1,12}$/.test(trimmed)) {
    throw new GeocodeError('A UPRN is a number of up to 12 digits.');
  }
  const params = new URLSearchParams({ uprn: trimmed, key: apiKey, output_srs: 'WGS84' });
  const res = await fetchFn(`${OS_PLACES_UPRN}?${params.toString()}`);
  if (res.status === 401 || res.status === 403) {
    throw new GeocodeError('The OS API key was rejected — check it in the UPRN tab.');
  }
  if (!res.ok) throw new GeocodeError('UPRN lookup failed — please try again.');
  const body = (await res.json()) as { results?: { DPA?: OsPlacesDpa }[] };
  const dpa = body.results?.[0]?.DPA;
  if (!dpa) throw new GeocodeError(`No address found for UPRN ${trimmed}.`);
  return { lat: dpa.LAT, lng: dpa.LNG, label: `UPRN ${dpa.UPRN} — ${dpa.ADDRESS}` };
}
