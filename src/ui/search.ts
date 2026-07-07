import { GeocodeError, geocodePostcode } from '../api/geocode';
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
export function createSearchPanel(
  root: HTMLElement,
  onSelect: (loc: LocationSelection) => void,
): { setBusy(busy: boolean): void } {
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

  root.append(
    el(
      'div',
      { class: 'search-panel' },
      postcodeForm,
      el('p', { class: 'search-divider' }, 'or'),
      coordsForm,
      error,
      el('p', { class: 'hint' }, 'Or click anywhere on the map.'),
    ),
  );

  return {
    setBusy(busy: boolean) {
      for (const form of [postcodeForm, coordsForm]) {
        for (const button of form.querySelectorAll('button')) button.disabled = busy;
      }
    },
  };
}
