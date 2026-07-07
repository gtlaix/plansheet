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

export interface MapController {
  setPin(lat: number, lng: number): void;
  showOverlays(collection: GeoJSON.FeatureCollection, scoreBySlug: Map<string, number>): void;
  clearOverlays(): void;
}

/**
 * Initialise the Leaflet map. `onPick` fires when the user clicks the map to
 * choose a location.
 */
export function createMap(container: HTMLElement, onPick: (lat: number, lng: number) => void): MapController {
  const map = L.map(container, { zoomControl: true }).setView([52.6, -1.6], 6);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const overlayGroup = L.featureGroup().addTo(map);
  let pin: L.CircleMarker | null = null;

  map.on('click', (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));

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
  };
}
