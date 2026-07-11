import { GeocodeError, geocodePostcode } from '../api/geocode';
import { BoundaryError, parseBoundary, type AreaGeometry } from '../geometry';
import { deleteSite, loadSavedSites, type SavedSite } from '../savedSites';
import type { LocationSelection } from '../types';

/** Small DOM helper: create element with props and children. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: className, ...rest } = props;
  if (className) node.className = className;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

/** Inline magnifier icon button — "Check location". */
function searchButton(): HTMLButtonElement {
  const button = el('button', { type: 'submit', class: 'icon-button' });
  button.setAttribute('aria-label', 'Check location');
  button.title = 'Check location';
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'd="M10.5 3a7.5 7.5 0 1 0 4.7 13.3l4.8 4.8m-4.8-4.8A7.5 7.5 0 0 0 10.5 3Z"/></svg>';
  return button;
}

/**
 * Search panel: one combined form group with a postcode row and a
 * latitude/longitude row. Resolved locations are passed to `onSelect`; the
 * map-click path lives in map.ts.
 */
export interface SearchPanel {
  setBusy(busy: boolean): void;
  /** Reflect the map's polygon-drawing state on the Draw button. */
  setDrawing(drawing: boolean): void;
  /** Fold the panel to a one-line summary after a successful check. */
  collapse(label: string): void;
  /** Re-read the saved-sites list from storage (call after saving). */
  refreshSaved(): void;
}

export function createSearchPanel(
  root: HTMLElement,
  onSelect: (loc: LocationSelection) => void,
  onBoundary: (geom: AreaGeometry, label?: string) => void,
  onDraw: () => void,
  onRecheck: (saved: SavedSite) => void = () => {},
): SearchPanel {
  const error = el('p', { class: 'search-error', role: 'alert', hidden: true });

  const showError = (msg: string) => {
    error.textContent = msg;
    error.hidden = false;
  };
  const clearError = () => {
    error.hidden = true;
  };

  async function resolve(fn: () => Promise<LocationSelection>) {
    clearError();
    try {
      onSelect(await fn());
    } catch (err) {
      showError(err instanceof GeocodeError ? err.message : 'Lookup failed — please try again.');
    }
  }

  // --- Postcode row ---
  const postcodeInput = el('input', {
    class: 'text-input',
    id: 'postcode-input',
    placeholder: 'e.g. SW1A 1AA',
    autocomplete: 'postal-code',
  });
  const postcodeForm = el(
    'form',
    { class: 'search-row' },
    el('label', { htmlFor: 'postcode-input', class: 'field-label' }, 'Postcode'),
    el('div', { class: 'input-with-button' }, postcodeInput, searchButton()),
  );
  postcodeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void resolve(() => geocodePostcode(postcodeInput.value));
  });

  // --- Coordinates row ---
  const latInput = el('input', { class: 'text-input', id: 'lat-input', placeholder: 'Latitude, e.g. 51.5014' });
  const lngInput = el('input', { class: 'text-input', id: 'lng-input', placeholder: 'Longitude, e.g. -0.1419' });
  const coordsForm = el(
    'form',
    { class: 'search-row' },
    el('label', { htmlFor: 'lat-input', class: 'field-label' }, 'Latitude / longitude'),
    el('div', { class: 'input-with-button' }, latInput, lngInput, searchButton()),
  );
  coordsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void resolve(async () => {
      const lat = Number(latInput.value.trim());
      const lng = Number(lngInput.value.trim());
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || latInput.value.trim() === '' || lngInput.value.trim() === '') {
        throw new GeocodeError('Enter numeric latitude and longitude (WGS84 decimal degrees).');
      }
      if (lat < 49 || lat > 61 || lng < -9 || lng > 3) {
        throw new GeocodeError('Those coordinates are outside Great Britain.');
      }
      return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    });
  });

  // --- British National Grid row (EPSG:27700, easting/northing) ---
  const eastingInput = el('input', { class: 'text-input', id: 'easting-input', placeholder: 'Easting, e.g. 529090', inputMode: 'numeric' });
  const northingInput = el('input', { class: 'text-input', id: 'northing-input', placeholder: 'Northing, e.g. 179645', inputMode: 'numeric' });
  const bngForm = el(
    'form',
    { class: 'search-row' },
    el('label', { htmlFor: 'easting-input', class: 'field-label' }, 'British National Grid (easting / northing)'),
    el('div', { class: 'input-with-button' }, eastingInput, northingInput, searchButton()),
  );
  bngForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void resolve(async () => {
      const easting = Number(eastingInput.value.trim());
      const northing = Number(northingInput.value.trim());
      // proj4 is heavy and only needed for grid input — load it on demand.
      const { bngToWgs84, isValidBng } = await import('../api/grid');
      if (eastingInput.value.trim() === '' || northingInput.value.trim() === '' || !isValidBng(easting, northing)) {
        throw new GeocodeError('Enter a valid National Grid easting and northing (metres).');
      }
      const { lat, lng } = bngToWgs84(easting, northing);
      return { lat, lng, label: `${easting}, ${northing} (BNG)` };
    });
  });

  // --- Site boundary: paste or upload GeoJSON / WKT (SPEC-01, story 3) ---
  const boundaryText = el('textarea', {
    class: 'boundary-text',
    id: 'boundary-text',
    rows: 4,
    placeholder: 'Paste GeoJSON or WKT, e.g. POLYGON ((-0.14 51.5, …))',
  });
  const boundaryFile = el('input', {
    type: 'file',
    class: 'file-input',
    id: 'boundary-file',
    accept: '.geojson,.json,.wkt,.txt',
  });
  const boundaryButton = el('button', { type: 'button', class: 'button' }, 'Check site boundary');

  const handleBoundary = (text: string) => {
    clearError();
    try {
      onBoundary(parseBoundary(text));
    } catch (err) {
      showError(err instanceof BoundaryError ? err.message : 'Could not read that boundary.');
    }
  };
  boundaryButton.addEventListener('click', () => handleBoundary(boundaryText.value));
  boundaryFile.addEventListener('change', () => {
    const file = boundaryFile.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      boundaryText.value = text;
      handleBoundary(text);
    });
  });

  const boundarySection = el(
    'details',
    { class: 'boundary-import' },
    el('summary', {}, 'or paste / upload GeoJSON or WKT'),
    el(
      'p',
      { class: 'hint' },
      'Paste or upload a boundary as GeoJSON or WKT in WGS84 longitude/latitude order.',
    ),
    boundaryText,
    el('div', { class: 'boundary-actions' }, boundaryFile, boundaryButton),
  );

  // --- Draw a site boundary (the drawing itself happens on the map) ---
  const drawButton = el('button', { type: 'button', class: 'button draw-button' }, '▱ Draw site on map');
  drawButton.addEventListener('click', () => onDraw());
  const setDrawing = (drawing: boolean) => {
    drawButton.textContent = drawing ? '✕ Cancel drawing' : '▱ Draw site on map';
    drawButton.classList.toggle('is-drawing', drawing);
  };

  const boundaryGroup = el(
    'div',
    { class: 'boundary-group' },
    el('label', { class: 'field-label' }, 'Site boundary — appraise a whole site'),
    drawButton,
    boundarySection,
  );

  // --- Saved sites: re-check a stored location and diff the snapshot ---
  const savedList = el('ul', { class: 'saved-list' });
  const savedSection = el(
    'details',
    { class: 'saved-sites' },
    el('summary', {}, 'Saved sites'),
    savedList,
  );
  const refreshSaved = () => {
    const sites = loadSavedSites();
    savedSection.hidden = sites.length === 0;
    savedSection.querySelector('summary')!.textContent = `Saved sites (${sites.length})`;
    savedList.replaceChildren(
      ...sites.map((site) => {
        const recheckBtn = el('button', { type: 'button', class: 'button button-secondary button-inline' }, 'Re-check');
        recheckBtn.addEventListener('click', () => onRecheck(site));
        const removeBtn = el('button', { type: 'button', class: 'icon-button remove-saved' }, '×');
        removeBtn.setAttribute('aria-label', `Delete saved site ${site.label}`);
        removeBtn.addEventListener('click', () => {
          deleteSite(site.id);
          refreshSaved();
        });
        const savedDate = new Date(site.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return el(
          'li',
          { class: 'saved-row' },
          el('span', { class: 'saved-label' }, site.label, el('span', { class: 'saved-date' }, ` · saved ${savedDate}`)),
          recheckBtn,
          removeBtn,
        );
      }),
    );
  };
  refreshSaved();

  const forms = el(
    'div',
    { class: 'search-forms' },
    postcodeForm,
    el('p', { class: 'search-divider' }, 'or'),
    coordsForm,
    el('p', { class: 'search-divider' }, 'or'),
    bngForm,
    boundaryGroup,
    savedSection,
    error,
    el('p', { class: 'hint' }, 'Or click anywhere on the map.'),
  );

  // Collapsed summary shown after a check, so the results have room.
  const summaryText = el('span', { class: 'search-summary-text' });
  const changeButton = el('button', { type: 'button', class: 'button button-secondary button-inline' }, '↻ New search');
  const setCollapsed = (collapsed: boolean) => {
    forms.hidden = collapsed;
    summary.hidden = !collapsed;
  };
  changeButton.addEventListener('click', () => setCollapsed(false));
  const summary = el(
    'div',
    { class: 'search-summary', hidden: true },
    el('span', { class: 'search-summary-label' }, 'Checked:'),
    summaryText,
    changeButton,
  );

  const panel = el('div', { class: 'search-panel' }, forms, summary);
  root.append(panel);

  return {
    setBusy(busy: boolean) {
      for (const button of forms.querySelectorAll('button')) button.disabled = busy;
    },
    setDrawing,
    collapse(label: string) {
      summaryText.textContent = label;
      setCollapsed(true);
    },
    refreshSaved,
  };
}
