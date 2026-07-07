import { GeocodeError, geocodePostcode, getOsApiKey, lookupUprn, setOsApiKey } from '../api/geocode';
import type { LocationSelection } from '../types';

type Tab = 'postcode' | 'coords' | 'uprn';

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

/**
 * Tabbed search panel: postcode / coordinates / UPRN. Resolved locations are
 * passed to `onSelect`; the map-click path lives in map.ts.
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

  // --- Postcode tab ---
  const postcodeInput = el('input', {
    class: 'text-input',
    id: 'postcode-input',
    placeholder: 'e.g. SW1A 1AA',
    autocomplete: 'postal-code',
  });
  const postcodeForm = el(
    'form',
    { class: 'search-form' },
    el('label', { htmlFor: 'postcode-input' }, 'Postcode'),
    postcodeInput,
    el('button', { type: 'submit', class: 'button' }, 'Check location'),
  );
  postcodeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void resolve(() => geocodePostcode(postcodeInput.value));
  });

  // --- Coordinates tab ---
  const latInput = el('input', { class: 'text-input', id: 'lat-input', placeholder: 'Latitude, e.g. 51.5014' });
  const lngInput = el('input', { class: 'text-input', id: 'lng-input', placeholder: 'Longitude, e.g. -0.1419' });
  const coordsForm = el(
    'form',
    { class: 'search-form' },
    el('label', { htmlFor: 'lat-input' }, 'Latitude'),
    latInput,
    el('label', { htmlFor: 'lng-input' }, 'Longitude'),
    lngInput,
    el('button', { type: 'submit', class: 'button' }, 'Check location'),
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

  // --- UPRN tab ---
  const uprnInput = el('input', { class: 'text-input', id: 'uprn-input', placeholder: 'e.g. 100023336956', inputMode: 'numeric' });
  const osKeyInput = el('input', {
    class: 'text-input',
    id: 'os-key-input',
    placeholder: 'OS Data Hub API key',
    value: getOsApiKey() ?? '',
  });
  const uprnForm = el(
    'form',
    { class: 'search-form' },
    el('label', { htmlFor: 'uprn-input' }, 'UPRN'),
    uprnInput,
    el('label', { htmlFor: 'os-key-input' }, 'OS Data Hub API key'),
    osKeyInput,
    el(
      'p',
      { class: 'hint' },
      'UPRN lookup uses the OS Places API, which needs a free API key from ',
      el('a', { href: 'https://osdatahub.os.uk/', target: '_blank', rel: 'noopener' }, 'osdatahub.os.uk'),
      '. The key is stored only in this browser.',
    ),
    el('button', { type: 'submit', class: 'button' }, 'Check location'),
  );
  uprnForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void resolve(async () => {
      const key = osKeyInput.value.trim();
      if (key === '') throw new GeocodeError('Enter your OS Data Hub API key to look up a UPRN.');
      setOsApiKey(key);
      return lookupUprn(uprnInput.value, key);
    });
  });

  // --- Tabs (WAI-ARIA tabs pattern: roving tabindex + arrow keys) ---
  const panels: Record<Tab, HTMLFormElement> = { postcode: postcodeForm, coords: coordsForm, uprn: uprnForm };
  const tabButtons: Record<Tab, HTMLButtonElement> = {
    postcode: el('button', { type: 'button', class: 'tab' }, 'Postcode'),
    coords: el('button', { type: 'button', class: 'tab' }, 'Coordinates'),
    uprn: el('button', { type: 'button', class: 'tab' }, 'UPRN'),
  };
  const tabOrder = Object.keys(tabButtons) as Tab[];
  for (const t of tabOrder) {
    tabButtons[t].setAttribute('role', 'tab');
    tabButtons[t].id = `tab-${t}`;
    tabButtons[t].setAttribute('aria-controls', `panel-${t}`);
    panels[t].setAttribute('role', 'tabpanel');
    panels[t].id = `panel-${t}`;
    panels[t].setAttribute('aria-labelledby', `tab-${t}`);
  }

  function activate(tab: Tab, focus = false) {
    clearError();
    for (const t of tabOrder) {
      const selected = t === tab;
      panels[t].hidden = !selected;
      tabButtons[t].classList.toggle('tab-active', selected);
      tabButtons[t].setAttribute('aria-selected', String(selected));
      tabButtons[t].tabIndex = selected ? 0 : -1;
    }
    if (focus) tabButtons[tab].focus();
  }
  for (const t of tabOrder) {
    tabButtons[t].addEventListener('click', () => activate(t));
    tabButtons[t].addEventListener('keydown', (e) => {
      const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) return;
      e.preventDefault();
      const next = tabOrder[(tabOrder.indexOf(t) + delta + tabOrder.length) % tabOrder.length];
      activate(next, true);
    });
  }

  root.append(
    el('div', { class: 'tabs', role: 'tablist' }, tabButtons.postcode, tabButtons.coords, tabButtons.uprn),
    postcodeForm,
    coordsForm,
    uprnForm,
    error,
    el('p', { class: 'hint' }, 'Or click anywhere on the map.'),
  );
  activate('postcode');

  return {
    setBusy(busy: boolean) {
      for (const form of Object.values(panels)) {
        for (const button of form.querySelectorAll('button')) button.disabled = busy;
      }
    },
  };
}
