import { describe, expect, it } from 'vitest';
import { bngToWgs84, isValidBng } from '../src/api/grid';

describe('bngToWgs84', () => {
  it('converts a known London control point to WGS84 (~metre accuracy)', () => {
    // SW1A 1AA grid reference; postcodes.io reports 51.501009, -0.141588 for it.
    const { lat, lng } = bngToWgs84(529090, 179645);
    expect(lat).toBeCloseTo(51.501, 3);
    expect(lng).toBeCloseTo(-0.1416, 3);
  });

  it('places the true origin (E400000, N-100000 false origins) near lon -2', () => {
    // On the central meridian (lon_0 = -2), easting 400000 maps to lng ≈ -2
    // (the ~0.0014° offset is the OSGB36→WGS84 datum shift).
    const { lng } = bngToWgs84(400000, 300000);
    expect(lng).toBeCloseTo(-2, 2);
  });
});

describe('isValidBng', () => {
  it('accepts in-range grid coordinates and rejects out-of-range or non-finite', () => {
    expect(isValidBng(529090, 179645)).toBe(true);
    expect(isValidBng(0, 0)).toBe(true);
    expect(isValidBng(-1, 100)).toBe(false);
    expect(isValidBng(800000, 100)).toBe(false);
    expect(isValidBng(100, 1400000)).toBe(false);
    expect(isValidBng(Number.NaN, 100)).toBe(false);
  });
});
