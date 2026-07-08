import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_LABELS, impactTier, TIER_LABELS, type ImpactTier } from '../datasets';
import type { Category } from '../types';

export const TIER_COLORS: Record<ImpactTier, string> = {
  'very-high': '#a4262c',
  high: '#c2510e',
  medium: '#996f00',
  low: '#2b5f9e',
  informational: '#5f6b7a',
};

const TIER_ORDER: ImpactTier[] = ['very-high', 'high', 'medium', 'low', 'informational'];

/** Generous envelope around England (Scilly → Berwick). Also used by main.ts. */
export const ENGLAND_BOUNDS = { south: 49.8, north: 55.9, west: -6.5, east: 1.8 };

/**
 * Basemap tile source. OSM is the default for personal use — check its tile
 * usage policy before deploying firm-wide (ISSUES-5). To switch to OS Maps API,
 * MapTiler or Carto, change these three values (and add any key to the URL);
 * nothing else in the app depends on the provider. See the README.
 */
export const BASEMAP = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

export interface MapController {
  setPin(lat: number, lng: number): void;
  showOverlays(
    collection: GeoJSON.FeatureCollection,
    scoreBySlug: Map<string, number>,
    categoryBySlug: Map<string, Category>,
  ): void;
  clearOverlays(): void;
  setDark(dark: boolean): void;
  showEnglandMask(border: GeoJSON.FeatureCollection | null): void;
  /** Render a drawn/imported site boundary and frame the map to it (SPEC-01). */
  showBoundary(geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon): void;
  clearBoundary(): void;
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
/** Minimal shape of the geoman API we use (it's lazy-loaded, so untyped here). */
interface GeomanDraw {
  enableDraw(shape: string, options?: Record<string, unknown>): void;
  disableDraw(): void;
}

export function createMap(
  container: HTMLElement,
  onPick: (lat: number, lng: number) => void,
  onBoundary: (geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) => void,
): MapController {
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

  L.tileLayer(BASEMAP.url, { maxZoom: BASEMAP.maxZoom, attribution: BASEMAP.attribution }).addTo(map);

  // Mask sits above tiles but below the overlay geometries and the pin.
  const maskPane = map.createPane('england-mask');
  maskPane.style.zIndex = '350';
  maskPane.style.pointerEvents = 'none';
  let mask: L.Polygon | null = null;

  // The site boundary sits above the constraint overlays so it stays legible.
  const boundaryPane = map.createPane('site-boundary');
  boundaryPane.style.zIndex = '450';

  const overlayGroup = L.featureGroup().addTo(map);
  let pin: L.CircleMarker | null = null;
  let boundary: L.GeoJSON | null = null;
  let layersControl: L.Control.Layers | null = null;

  // Static severity legend (key to the overlay colours).
  const legend = new L.Control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML =
      '<strong>Impact</strong>' +
      TIER_ORDER.map((t) => `<span class="legend-row"><i style="background:${TIER_COLORS[t]}"></i>${TIER_LABELS[t]}</span>`).join('');
    return div;
  };
  legend.addTo(map);

  // --- Draw-a-site control (geoman is lazy-loaded on first use, keeping it out
  //     of the main bundle; a completed polygon feeds the same check pipeline) ---
  let drawing = false;
  let geomanLoaded: Promise<void> | null = null;

  const pm = () => (map as unknown as { pm: GeomanDraw }).pm;

  const drawButton = L.DomUtil.create('button', 'map-draw-button');
  drawButton.type = 'button';
  drawButton.setAttribute('aria-label', 'Draw a site boundary');

  const setDrawLabel = () => {
    drawButton.textContent = drawing ? '✕ Cancel drawing' : '▱ Draw site';
    drawButton.title = drawing ? 'Cancel drawing' : 'Draw a site boundary — click corners, double-click to finish';
    drawButton.classList.toggle('is-drawing', drawing);
  };
  setDrawLabel();

  const stopDrawing = () => {
    drawing = false;
    setDrawLabel();
    try {
      pm().disableDraw();
    } catch {
      // geoman not loaded yet — nothing to disable
    }
  };

  const loadGeoman = () => {
    if (!geomanLoaded) {
      geomanLoaded = (async () => {
        await import('@geoman-io/leaflet-geoman-free');
        await import('@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css');
        // geoman wires `map.pm` from a Leaflet init hook that only runs for maps
        // built after the plugin loads. Ours predates the lazy import, so attach
        // the handler manually.
        const geoman = (L as unknown as { PM?: { Map: new (m: L.Map) => GeomanDraw } }).PM;
        const target = map as unknown as { pm?: GeomanDraw };
        if (!target.pm && geoman) target.pm = new geoman.Map(map);
        (map as unknown as { on(t: string, f: (e: { layer: L.Layer }) => void): void }).on('pm:create', (e) => {
          const feature = (e.layer as unknown as { toGeoJSON(): GeoJSON.Feature }).toGeoJSON();
          map.removeLayer(e.layer); // we render our own styled boundary via the pipeline
          stopDrawing();
          const geom = feature.geometry;
          if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) onBoundary(geom);
        });
      })();
    }
    return geomanLoaded;
  };

  const startDrawing = async () => {
    await loadGeoman();
    drawing = true;
    setDrawLabel();
    pm().enableDraw('Polygon', { snappable: true, finishOn: 'dblclick' });
  };

  L.DomEvent.on(drawButton, 'click', (e) => {
    L.DomEvent.stop(e);
    if (drawing) stopDrawing();
    else void startDrawing();
  });

  const drawControl = new L.Control({ position: 'topleft' });
  drawControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'leaflet-bar map-draw-control');
    L.DomEvent.disableClickPropagation(div);
    div.appendChild(drawButton);
    return div;
  };
  drawControl.addTo(map);

  map.on('click', (e: L.LeafletMouseEvent) => {
    if (drawing) return; // clicks are placing polygon vertices, not picking a point
    onPick(e.latlng.lat, e.latlng.lng);
  });

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
      if (drawing) stopDrawing(); // a point check cancels an in-progress draw
      this.clearBoundary(); // pin and boundary are mutually exclusive markers
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

    showBoundary(geojson) {
      this.clearBoundary();
      if (pin) {
        pin.remove();
        pin = null;
      }
      boundary = L.geoJSON(geojson, {
        pane: 'site-boundary',
        style: { color: '#2563eb', weight: 3, dashArray: '6 4', fillColor: '#2563eb', fillOpacity: 0.06 },
      }).addTo(map);
      const bounds = boundary.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 17, padding: [24, 24] });
    },

    clearBoundary() {
      if (boundary) {
        boundary.remove();
        boundary = null;
      }
    },

    showOverlays(collection, scoreBySlug, categoryBySlug) {
      this.clearOverlays();
      const colourFor = (feature: GeoJSON.Feature | undefined) =>
        TIER_COLORS[impactTier(scoreBySlug.get(String(feature?.properties?.dataset ?? '')) ?? 0)];
      const options: L.GeoJSONOptions = {
        style: (feature) => {
          const color = colourFor(feature);
          return { color, weight: 2, fillColor: color, fillOpacity: 0.12 };
        },
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, { radius: 6, color: colourFor(feature), weight: 2, fillOpacity: 0.4 }),
        onEachFeature: (feature, layer) => {
          const name = feature?.properties?.name || feature?.properties?.reference || '';
          const dataset = String(feature?.properties?.dataset ?? '').replace(/-/g, ' ');
          if (name || dataset) layer.bindTooltip(`${dataset}${name ? `: ${name}` : ''}`);
        },
      };

      // Group features by category so each can be toggled independently.
      const groups = new Map<Category, L.LayerGroup>();
      for (const feature of collection.features ?? []) {
        const slug = String(feature.properties?.dataset ?? '');
        const category = categoryBySlug.get(slug) ?? 'other';
        let group = groups.get(category);
        if (!group) {
          group = L.layerGroup().addTo(overlayGroup);
          groups.set(category, group);
        }
        L.geoJSON(feature, options).addTo(group);
      }

      if (groups.size > 0) {
        const overlays: Record<string, L.Layer> = {};
        for (const [category, group] of groups) overlays[CATEGORY_LABELS[category]] = group;
        layersControl = L.control.layers(undefined, overlays, { collapsed: false, position: 'topright' }).addTo(map);
      }
    },

    clearOverlays() {
      overlayGroup.clearLayers();
      if (layersControl) {
        layersControl.remove();
        layersControl = null;
      }
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
