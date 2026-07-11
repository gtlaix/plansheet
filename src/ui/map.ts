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
  /** Start or cancel polygon-drawing mode (the trigger lives in the search panel). */
  toggleDraw(): void;
  /** Render a proximity scan: the scanned envelope + nearby features (SPEC-04). */
  showProximity(
    envelope: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    items: { feature: GeoJSON.Feature; score: number; tooltip: string }[],
  ): void;
  clearProximity(): void;
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
  onDrawChange: (drawing: boolean) => void = () => {},
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

  // Proximity-scan features sit between the overlays and the boundary.
  const proximityPane = map.createPane('proximity');
  proximityPane.style.zIndex = '430';

  const overlayGroup = L.featureGroup().addTo(map);
  const proximityGroup = L.featureGroup().addTo(map);
  let pin: L.CircleMarker | null = null;
  let boundary: L.GeoJSON | null = null;
  let layersControl: L.Control.Layers | null = null;

  // Overlay opacity: one slider scaling every constraint layer's opacity
  // (SPEC-02). Base fill opacities are tagged per layer at creation.
  let opacityFactor = 1;
  const applyOpacity = (group: L.LayerGroup) => {
    group.eachLayer((layer) => {
      if (layer instanceof L.LayerGroup) {
        applyOpacity(layer);
        return;
      }
      const l = layer as L.Path & { _baseFill?: number };
      if (typeof l.setStyle === 'function' && l._baseFill !== undefined) {
        l.setStyle({
          opacity: opacityFactor,
          fillOpacity: Math.round(l._baseFill * opacityFactor * 1000) / 1000,
        });
      }
    });
  };

  const opacityControl = new L.Control({ position: 'bottomleft' });
  opacityControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-opacity');
    const input = L.DomUtil.create('input', 'opacity-slider', div) as HTMLInputElement;
    input.type = 'range';
    input.min = '0.1';
    input.max = '1';
    input.step = '0.1';
    input.value = '1';
    input.setAttribute('aria-label', 'Constraint overlay opacity');
    input.title = 'Overlay opacity';
    L.DomEvent.disableClickPropagation(div);
    input.addEventListener('input', () => {
      opacityFactor = Number(input.value);
      applyOpacity(overlayGroup);
    });
    return div;
  };
  opacityControl.addTo(map);

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

  // --- Draw-a-site (geoman is lazy-loaded on first use, keeping it out of the
  //     main bundle; a completed polygon feeds the same check pipeline). The
  //     draw trigger lives in the search panel; the map just owns the mode. ---
  let drawing = false;
  let geomanLoaded: Promise<void> | null = null;

  const pm = () => (map as unknown as { pm: GeomanDraw }).pm;

  const stopDrawing = () => {
    const wasDrawing = drawing;
    drawing = false;
    try {
      pm().disableDraw();
    } catch {
      // geoman not loaded yet — nothing to disable
    }
    if (wasDrawing) onDrawChange(false);
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
    onDrawChange(true);
    pm().enableDraw('Polygon', { snappable: true, finishOn: 'dblclick' });
  };

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

    toggleDraw() {
      if (drawing) stopDrawing();
      else void startDrawing();
    },

    showProximity(envelope, items) {
      this.clearProximity();
      // The scanned area: a subtle dashed rectangle (the envelope actually queried).
      L.geoJSON(envelope as GeoJSON.GeoJsonObject, {
        pane: 'proximity',
        style: { color: '#64748b', weight: 1.5, dashArray: '2 6', fill: false },
        interactive: false,
      }).addTo(proximityGroup);
      for (const { feature, score, tooltip } of items) {
        const color = TIER_COLORS[impactTier(score)];
        L.geoJSON(feature, {
          pane: 'proximity',
          style: { color, weight: 1.5, dashArray: '5 4', fillColor: color, fillOpacity: 0.05 },
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, { pane: 'proximity', radius: 5, color, weight: 1.5, dashArray: '3 3', fillOpacity: 0.2 }),
          onEachFeature: (_f, layer) => layer.bindTooltip(tooltip),
        }).addTo(proximityGroup);
      }
      const bounds = proximityGroup.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16] });
    },

    clearProximity() {
      proximityGroup.clearLayers();
    },

    showOverlays(collection, scoreBySlug, categoryBySlug) {
      this.clearOverlays();
      const colourFor = (feature: GeoJSON.Feature | undefined) =>
        TIER_COLORS[impactTier(scoreBySlug.get(String(feature?.properties?.dataset ?? '')) ?? 0)];
      const options: L.GeoJSONOptions = {
        style: (feature) => {
          const color = colourFor(feature);
          return { color, weight: 2, fillColor: color, opacity: opacityFactor, fillOpacity: 0.12 * opacityFactor };
        },
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, {
            radius: 6,
            color: colourFor(feature),
            weight: 2,
            opacity: opacityFactor,
            fillOpacity: 0.4 * opacityFactor,
          }),
        onEachFeature: (feature, layer) => {
          // Remember the un-scaled fill so the opacity slider can re-derive it.
          (layer as L.Path & { _baseFill?: number })._baseFill = feature?.geometry?.type === 'Point' ? 0.4 : 0.12;
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
