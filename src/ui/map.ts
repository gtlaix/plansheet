import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { impactTier, type ImpactTier } from '../datasets';

export const TIER_COLORS: Record<ImpactTier, string> = {
  'very-high': '#a4262c',
  high: '#c2510e',
  medium: '#996f00',
  low: '#2b5f9e',
  informational: '#5f6b7a',
};

/** Generous envelope around England (Scilly → Berwick). Also used by main.ts. */
export const ENGLAND_BOUNDS = { south: 49.8, north: 55.9, west: -6.5, east: 1.8 };

export interface MapController {
  setPin(lat: number, lng: number): void;
  showOverlays(collection: GeoJSON.FeatureCollection, scoreBySlug: Map<string, number>): void;
  clearOverlays(): void;
  setDark(dark: boolean): void;
  showEnglandMask(border: GeoJSON.FeatureCollection | null): void;
}

/** A rectangle comfortably larger than the map's max bounds, for the mask's outer ring. */
const MASK_OUTER: L.LatLngTuple[] = [
  [40, -25],
  [40, 25],
  [62, 25],
  [62, -25],
];

/** Collect every exterior ring (as [lat,lng]) from England's Polygon/MultiPolygon features. */
function englandRings(border: GeoJSON.FeatureCollection): L.LatLngTuple[][] {
  const rings: L.LatLngTuple[][] = [];
  const addPolygon = (polygon: GeoJSON.Position[][]) => {
    const exterior = polygon[0];
    if (exterior?.length) rings.push(exterior.map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
  };
  for (const feature of border.features) {
    const geom = feature.geometry;
    if (geom?.type === 'Polygon') addPolygon(geom.coordinates);
    else if (geom?.type === 'MultiPolygon') geom.coordinates.forEach(addPolygon);
  }
  return rings;
}

/**
 * Initialise the Leaflet map. `onPick` fires when the user clicks the map to
 * choose a location. The view is framed and locked to England so the continent
 * (and most of Scotland) can't be panned in.
 */
export function createMap(container: HTMLElement, onPick: (lat: number, lng: number) => void): MapController {
  const bounds = L.latLngBounds(
    [ENGLAND_BOUNDS.south, ENGLAND_BOUNDS.west],
    [ENGLAND_BOUNDS.north, ENGLAND_BOUNDS.east],
  );
  const map = L.map(container, {
    zoomControl: true,
    minZoom: 6,
    maxBounds: bounds,
    maxBoundsViscosity: 1,
  });
  map.fitBounds(bounds);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Mask sits above tiles but below the overlay geometries and the pin.
  const maskPane = map.createPane('england-mask');
  maskPane.style.zIndex = '350';
  maskPane.style.pointerEvents = 'none';
  let mask: L.Polygon | null = null;

  const overlayGroup = L.featureGroup().addTo(map);
  let pin: L.CircleMarker | null = null;

  map.on('click', (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));

  // Keyboard path: the map container is focusable (Leaflet sets tabindex=0);
  // arrow keys pan and Enter checks the current centre — a click alternative.
  container.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = map.getCenter();
      onPick(c.lat, c.lng);
    }
  });

  return {
    setPin(lat: number, lng: number) {
      if (pin) pin.remove();
      pin = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#1d2939',
        fillOpacity: 1,
      }).addTo(map);
      const targetZoom = Math.max(map.getZoom(), 15);
      map.setView([lat, lng], targetZoom);
    },

    showOverlays(collection, scoreBySlug) {
      overlayGroup.clearLayers();
      L.geoJSON(collection, {
        style: (feature) => {
          const slug = String(feature?.properties?.dataset ?? '');
          const tier = impactTier(scoreBySlug.get(slug) ?? 0);
          const color = TIER_COLORS[tier];
          return { color, weight: 2, fillColor: color, fillOpacity: 0.12 };
        },
        pointToLayer: (feature, latlng) => {
          const slug = String(feature?.properties?.dataset ?? '');
          const tier = impactTier(scoreBySlug.get(slug) ?? 0);
          return L.circleMarker(latlng, {
            radius: 6,
            color: TIER_COLORS[tier],
            weight: 2,
            fillOpacity: 0.4,
          });
        },
        onEachFeature: (feature, layer) => {
          const name = feature?.properties?.name || feature?.properties?.reference || '';
          const dataset = String(feature?.properties?.dataset ?? '').replace(/-/g, ' ');
          if (name || dataset) layer.bindTooltip(`${dataset}${name ? `: ${name}` : ''}`);
        },
      }).addTo(overlayGroup);
    },

    clearOverlays() {
      overlayGroup.clearLayers();
    },

    setDark(dark: boolean) {
      container.classList.toggle('dark-map', dark);
    },

    showEnglandMask(border) {
      if (mask) {
        mask.remove();
        mask = null;
      }
      if (!border) return;
      const holes = englandRings(border);
      if (holes.length === 0) return;
      // One polygon: outer rectangle + England rings as holes = everything
      // outside England is filled.
      mask = L.polygon([MASK_OUTER, ...holes], {
        pane: 'england-mask',
        stroke: false,
        fillColor: '#334155',
        fillOpacity: 0.55,
        interactive: false,
      }).addTo(map);
    },
  };
}
