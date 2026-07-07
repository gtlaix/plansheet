import { describe, expect, it, vi } from 'vitest';
import { GeocodeError, geocodePostcode, lookupUprn, reverseGeocode } from '../src/api/geocode';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('geocodePostcode', () => {
  it('resolves a postcode to WGS84 coordinates', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        result: { postcode: 'SW1A 1AA', latitude: 51.501009, longitude: -0.141588, admin_district: 'Westminster' },
      }),
    );
    const loc = await geocodePostcode('sw1a1aa', fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith('https://api.postcodes.io/postcodes/sw1a1aa');
    expect(loc).toEqual({ lat: 51.501009, lng: -0.141588, label: 'SW1A 1AA' });
  });

  it('rejects unknown postcodes with a user-facing error', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ status: 404, error: 'Postcode not found' }, 404));
    await expect(geocodePostcode('ZZ99 9ZZ', fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(GeocodeError);
  });

  it('rejects empty input without calling the API', async () => {
    const fetchFn = vi.fn();
    await expect(geocodePostcode('   ', fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(GeocodeError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('reverseGeocode', () => {
  it('returns the nearest postcode', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: [{ postcode: 'SW1A 1AA' }] }));
    expect(await reverseGeocode(51.5, -0.14, fetchFn as unknown as typeof fetch)).toBe('SW1A 1AA');
  });

  it('suppresses postcodes further than 200 m from the point', async () => {
    const far = vi.fn(async () => jsonResponse({ result: [{ postcode: 'YO62 4LB', distance: 1450.7 }] }));
    expect(await reverseGeocode(54.25, -0.95, far as unknown as typeof fetch)).toBeNull();
    const near = vi.fn(async () => jsonResponse({ result: [{ postcode: 'SW1A 1AA', distance: 42.1 }] }));
    expect(await reverseGeocode(51.5, -0.14, near as unknown as typeof fetch)).toBe('SW1A 1AA');
  });

  it('is best-effort: null on failure or no result', async () => {
    const failing = vi.fn(async () => {
      throw new Error('down');
    });
    expect(await reverseGeocode(51.5, -0.14, failing as unknown as typeof fetch)).toBeNull();
    const empty = vi.fn(async () => jsonResponse({ result: null }));
    expect(await reverseGeocode(51.5, -0.14, empty as unknown as typeof fetch)).toBeNull();
  });
});

describe('lookupUprn', () => {
  it('resolves a UPRN via OS Places with WGS84 output', async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({
        results: [{ DPA: { UPRN: '100023336956', ADDRESS: 'BUCKINGHAM PALACE, LONDON, SW1A 1AA', LAT: 51.5014, LNG: -0.1419 } }],
      });
    });
    const loc = await lookupUprn('100023336956', 'test-key', fetchFn as unknown as typeof fetch);
    expect(urls[0]).toContain('uprn=100023336956');
    expect(urls[0]).toContain('output_srs=WGS84');
    expect(loc.lat).toBe(51.5014);
    expect(loc.label).toContain('UPRN 100023336956');
  });

  it('rejects malformed UPRNs without calling the API', async () => {
    const fetchFn = vi.fn();
    await expect(lookupUprn('not-a-number', 'k', fetchFn as unknown as typeof fetch)).rejects.toBeInstanceOf(GeocodeError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports a rejected API key clearly', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'invalid key' }, 401));
    await expect(lookupUprn('123', 'bad-key', fetchFn as unknown as typeof fetch)).rejects.toThrow(/OS API key/);
  });
});
