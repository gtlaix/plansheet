import { expect, test, type Page } from '@playwright/test';

// --- Stub fixtures (shapes match the live API; no network in CI) ---
const DATASETS = {
  datasets: [
    { dataset: 'conservation-area', name: 'Conservation area', typology: 'geography' },
    { dataset: 'listed-building', name: 'Listed building', typology: 'geography' },
    { dataset: 'flood-risk-zone', name: 'Flood risk zone', typology: 'geography' },
    { dataset: 'article-4-direction-area', name: 'Article 4 direction area', typology: 'geography' },
    { dataset: 'green-belt', name: 'Green belt', typology: 'geography' },
    { dataset: 'local-planning-authority', name: 'Local planning authority', typology: 'geography' },
    { dataset: 'ward', name: 'Ward', typology: 'geography' },
    { dataset: 'parish', name: 'Parish', typology: 'geography' },
    { dataset: 'tree-preservation-zone', name: 'Tree preservation zone', typology: 'geography' },
    { dataset: 'site-of-special-scientific-interest', name: 'Site of special scientific interest', typology: 'geography' },
    { dataset: 'planning-application', name: 'Planning application', typology: 'geography' },
    { dataset: 'title-boundary', name: 'Title boundary', typology: 'geography' },
    { dataset: 'shiny-new-designation', name: 'Shiny new designation', typology: 'geography' },
    { dataset: 'border', name: 'Border', typology: 'geography' },
    { dataset: 'article-4-direction', name: 'Article 4 direction', typology: 'legal-instrument' },
  ],
};

const ENTITIES = {
  count: 7,
  entities: [
    { entity: 101, name: 'City of Westminster', dataset: 'local-planning-authority', reference: 'LPA1', typology: 'geography', 'start-date': '1965-04-01', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 102, name: "St James's", dataset: 'ward', reference: 'W1', typology: 'geography', 'start-date': '2000-01-01', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 201, name: 'Buckingham Palace', dataset: 'listed-building', reference: '1234567', 'listed-building-grade': 'I', typology: 'geography', 'start-date': '1970-02-05', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 202, name: 'Flood Zone', dataset: 'flood-risk-zone', reference: 'FZ2', 'flood-risk-level': '2', typology: 'geography', 'start-date': '', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 203, name: 'Whitehall Conservation Area', dataset: 'conservation-area', reference: 'CA55', typology: 'geography', 'start-date': '1969-01-01', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 204, name: 'Mystery Zone', dataset: 'shiny-new-designation', reference: 'X1', typology: 'geography', 'start-date': '', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 205, name: 'England', dataset: 'border', reference: 'ENG', typology: 'geography', 'start-date': '', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 301, name: '', dataset: 'title-boundary', reference: 'INSPIRE-301', typology: 'geography', 'start-date': '', 'end-date': '', 'entry-date': '2024-01-01' },
    { entity: 401, name: '', dataset: 'planning-application', reference: '24/01234/FUL', description: 'Two-storey rear extension and loft conversion', 'planning-application-status': 'decided', 'planning-application-type': 'full', 'planning-decision': 'granted', 'decision-date': '2024-06-01', 'documentation-url': 'https://lpa.example/apps/24-01234', typology: 'geography', 'start-date': '2024-02-01', 'end-date': '', 'entry-date': '2024-06-02' },
    { entity: 402, name: '', dataset: 'planning-application', reference: '19/00777/HOU', description: 'Single garage', 'planning-decision': 'refused', 'decision-date': '2019-03-01', typology: 'geography', 'start-date': '2019-01-01', 'end-date': '', 'entry-date': '2019-03-02' },
  ],
};

// Served for geometry (polygon/envelope) queries: the on-site conservation
// area (entity 203; covers the west half of the fixture site polygon, for the
// coverage figure) plus a SSSI ~215 m east of the SW1A 1AA point (proximity).
const GEOMETRY_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { dataset: 'conservation-area', entity: 203, name: 'Whitehall Conservation Area', reference: 'CA55' },
      geometry: { type: 'Polygon', coordinates: [[[-0.145, 51.499], [-0.1415, 51.499], [-0.1415, 51.504], [-0.145, 51.504], [-0.145, 51.499]]] },
    },
    {
      type: 'Feature',
      properties: { dataset: 'site-of-special-scientific-interest', entity: 900, name: 'Test Marsh SSSI', reference: 'SSSI1' },
      geometry: { type: 'Polygon', coordinates: [[[-0.1385, 51.5], [-0.1375, 51.5], [-0.1375, 51.502], [-0.1385, 51.502], [-0.1385, 51.5]]] },
    },
  ],
};

const TITLE_GEOJSON = {
  type: 'Feature',
  properties: { dataset: 'title-boundary', reference: 'INSPIRE-301' },
  geometry: { type: 'Polygon', coordinates: [[[-0.144, 51.4995], [-0.139, 51.4995], [-0.139, 51.5035], [-0.144, 51.5035], [-0.144, 51.4995]]] },
};

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { dataset: 'conservation-area', name: 'Whitehall Conservation Area' }, geometry: { type: 'Polygon', coordinates: [[[-0.146, 51.499], [-0.137, 51.499], [-0.137, 51.504], [-0.146, 51.504], [-0.146, 51.499]]] } },
    { type: 'Feature', properties: { dataset: 'listed-building', name: 'Buckingham Palace' }, geometry: { type: 'Point', coordinates: [-0.1419, 51.5014] } },
  ],
};

const BORDER_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { dataset: 'border', name: 'England' }, geometry: { type: 'Polygon', coordinates: [[[-6, 50], [2, 50], [2, 56], [-6, 56], [-6, 50]]] } },
  ],
};

const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function stubApis(page: Page): Promise<void> {
  await page.route('**tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }),
  );
  await page.route('**www.planning.data.gov.uk/dataset.json*', (route) => route.fulfill({ json: DATASETS }));
  await page.route('**www.planning.data.gov.uk/entity.json*', (route) => route.fulfill({ json: ENTITIES }));
  await page.route('**www.planning.data.gov.uk/entity/*.geojson', (route) => route.fulfill({ json: TITLE_GEOJSON }));
  await page.route('**www.planning.data.gov.uk/entity.geojson*', (route) => {
    const url = route.request().url();
    if (url.includes('dataset=border')) return route.fulfill({ json: BORDER_GEOJSON });
    // Geometry (envelope/polygon) queries serve the coverage/proximity fixture.
    if (url.includes('geometry=')) return route.fulfill({ json: GEOMETRY_GEOJSON });
    return route.fulfill({ json: GEOJSON });
  });
  await page.route('**api.postcodes.io/postcodes/**', (route) =>
    route.fulfill({ json: { result: { postcode: 'SW1A 1AA', latitude: 51.501009, longitude: -0.141588 } } }),
  );
  await page.route('**api.postcodes.io/postcodes?*', (route) =>
    route.fulfill({ json: { result: [{ postcode: 'SW1A 1AA' }] } }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubApis(page);
  await page.goto('/');
  await page.waitForSelector('.report.idle');
});

test('combined search panel has no tab strip and both input modes', async ({ page }) => {
  await expect(page.locator('.tabs')).toHaveCount(0);
  await expect(page.locator('#postcode-input')).toBeVisible();
  await expect(page.locator('#lat-input')).toBeVisible();
});

test('England mask renders from the border layer', async ({ page }) => {
  await expect(page.locator('.leaflet-england-mask-pane path')).toHaveCount(1);
});

test('the severity legend is shown on the map', async ({ page }) => {
  await expect(page.locator('.map-legend')).toBeVisible();
  await expect(page.locator('.map-legend')).toContainText('Very high impact');
});

test('a postcode generates a ranked plan sheet, admin first', async ({ page }) => {
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.hit-list');

  await expect(page.locator('.admin-list')).toContainText('City of Westminster');

  const titles = await page.$$eval('.hit-list .hit h4', (els) => els.map((e) => e.textContent!.trim()));
  const iPalace = titles.indexOf('Buckingham Palace');
  const iCons = titles.indexOf('Whitehall Conservation Area');
  const iFlood = titles.findIndex((t) => t.includes('Flood Zone'));
  expect(iPalace).toBe(0);
  expect(iCons).toBeGreaterThan(iPalace);
  expect(iFlood).toBeGreaterThan(iCons);

  // unmapped dataset still shown; excluded border layer never shown
  expect(titles).toContain('Mystery Zone');
  expect(titles).not.toContain('England');
  await expect(page.locator('#report-root')).not.toContainText(/\bBorder\b/);

  // coverage honesty + data gaps + export
  await expect(page.locator('#report-root')).toContainText('No data found — coverage incomplete');
  await expect(page.locator('.partial-list')).toContainText('Article 4 direction area');
  await expect(page.locator('#report-root')).toContainText('Not covered by this check');
  await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Print/ })).toHaveCount(0);

  // no always-on flood note
  await expect(page.locator('#report-root')).not.toContainText('falls in Flood Zone 1');

  // shareable link
  expect(page.url()).toContain('lat=51.501');

  // a11y: report is a labelled landmark and badges announce the rating
  await expect(page.locator('.report[role="region"]')).toHaveCount(1);
  await expect(page.locator('.hit-list')).toHaveAttribute('aria-label', /most significant first/);
  await expect(page.locator('.hit-list .badge').first()).toHaveAttribute('aria-label', /Impact rating/);

  // entity detail drawer expands to show raw fields
  await page.locator('.hit-list .hit-more summary').first().click();
  await expect(page.locator('.hit-list .hit-fields').first()).toContainText('Dataset');

  // per-category layer toggle appears once overlays load
  await expect(page.locator('.leaflet-control-layers')).toContainText('Heritage');

  // planning history: its own section, newest first, decision + docs link,
  // and NOT counted among the constraints
  await expect(page.locator('#report-root')).toContainText('Planning history (2 applications)');
  const appTitles = await page.$$eval('.app-list h4', (els) => els.map((e) => e.textContent!.trim()));
  expect(appTitles[0]).toContain('24/01234/FUL'); // 2024 decision before the 2019 one
  await expect(page.locator('.app-list')).toContainText('Two-storey rear extension');
  await expect(page.locator('.app-list')).toContainText('granted');
  await expect(page.locator('.app-list a[href="https://lpa.example/apps/24-01234"]')).toBeVisible();
  const constraintTitles = await page.$$eval('.hit-list .hit h4', (els) => els.map((e) => e.textContent!.trim()));
  expect(constraintTitles.join(' ')).not.toContain('24/01234/FUL');
});

test('a title boundary can be adopted as the site boundary', async ({ page }) => {
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.hit-list');

  // The admin section offers the registered title as a site boundary.
  const useBtn = page.getByRole('button', { name: 'Use as site boundary' });
  await expect(useBtn).toBeVisible();
  await useBtn.click();

  // It fetches the title geometry and re-runs as a polygon check.
  await page.waitForSelector('.report-area');
  await expect(page.locator('.report-sub')).toContainText('title boundary');
  await expect(page.locator('.leaflet-site-boundary-pane path')).toHaveCount(1);
});

test('the map is keyboard-operable: Enter checks the centre', async ({ page }) => {
  await page.locator('#map').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hit-list')).toBeVisible();
});

test('British National Grid easting/northing runs a check', async ({ page }) => {
  await page.fill('#easting-input', '529090');
  await page.fill('#northing-input', '179645');
  await page.press('#northing-input', 'Enter');
  await expect(page.locator('.hit-list')).toBeVisible();
  expect(page.url()).toContain('lat=51.50');
});

test('pasting a site boundary runs a polygon check, shows area and draws it', async ({ page }) => {
  await page.locator('.boundary-import > summary').click();
  await page.fill(
    '#boundary-text',
    'POLYGON ((-0.145 51.499, -0.138 51.499, -0.138 51.504, -0.145 51.504, -0.145 51.499))',
  );
  await page.getByRole('button', { name: 'Check site boundary' }).click();

  await page.waitForSelector('.hit-list');
  // site area is shown, in m² and hectares
  await expect(page.locator('.report-area')).toContainText('Site area');
  await expect(page.locator('.report-area')).toContainText('ha');
  // the boundary is rendered on the map in its own pane
  await expect(page.locator('.leaflet-site-boundary-pane path')).toHaveCount(1);
  // the geometry query still returns the ranked constraints
  await expect(page.locator('.hit-list')).toContainText('Buckingham Palace');
  // the conservation area's site-coverage figure appears on its card (SPEC-02):
  // its fixture geometry covers the west half of the pasted site.
  await expect(page.locator('.hit-coverage').first()).toContainText('50% of the site');
  // the boundary is encoded into a shareable ?site= link (not a point ?lat=)
  expect(page.url()).toContain('site=');
  expect(page.url()).not.toContain('lat=');
  // JSON export still available for a polygon check
  await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();

  // opening that shared link restores the same site boundary
  await page.goto(page.url());
  await page.waitForSelector('.report-area');
  await expect(page.locator('.leaflet-site-boundary-pane path')).toHaveCount(1);
  await expect(page.locator('.report-sub')).toContainText('Shared site boundary');
});

test('drawing a site boundary on the map runs a polygon check', async ({ page }) => {
  const drawBtn = page.locator('.draw-button');
  await expect(drawBtn).toContainText('Draw site on map');

  // Entering draw mode lazy-loads geoman, so the label flips asynchronously.
  await drawBtn.click();
  await expect(drawBtn).toContainText('Cancel drawing');
  await expect(page.locator('#map')).toHaveClass(/geoman-draw-cursor/);

  // Place four vertices, then close the ring by clicking the first vertex.
  // A gap between clicks stops geoman reading two fast clicks as a finishing
  // double-click. These map clicks place vertices — the guard means they must
  // not trigger a point check (a leaked point check would render no .report-area).
  const box = (await page.locator('#map').boundingBox())!;
  const corners = [[160, 130], [320, 130], [320, 270], [160, 270]];
  for (const [dx, dy] of corners) {
    await page.mouse.click(box.x + dx, box.y + dy);
    await page.waitForTimeout(180);
  }
  await page.mouse.click(box.x + 160, box.y + 130); // click first vertex to close

  await page.waitForSelector('.report-area'); // a site (polygon) report, not a point
  await expect(page.locator('.leaflet-site-boundary-pane path')).toHaveCount(1);
  await expect(page.locator('.hit-list')).toContainText('Buckingham Palace');
  await expect(drawBtn).toContainText('Draw site'); // draw mode ended on completion
});

test('an easting/northing boundary is rejected with a reproject message', async ({ page }) => {
  await page.locator('.boundary-import > summary').click();
  await page.fill(
    '#boundary-text',
    'POLYGON ((529000 179000, 530000 179000, 530000 180000, 529000 180000, 529000 179000))',
  );
  await page.getByRole('button', { name: 'Check site boundary' }).click();
  await expect(page.locator('.search-error')).toContainText('EPSG:27700');
});

test('a proximity scan lists nearby constraints with distance and bearing', async ({ page }) => {
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.hit-list');

  // The scan control is offered after any check.
  await expect(page.locator('#radius-select')).toBeVisible();
  await page.selectOption('#radius-select', '500');
  await page.getByRole('button', { name: 'Scan surroundings' }).click();

  // The nearby section renders the SSSI with an approximate distance + bearing.
  await page.waitForSelector('.nearby-list');
  await expect(page.locator('.nearby-list')).toContainText('Test Marsh SSSI');
  await expect(page.locator('.nearby-list .distance-tag').first()).toHaveText(/≈ \d+ m E/);
  await expect(page.locator('#report-root')).toContainText('NOT on the site');
  // The scan area + nearby feature render in the proximity pane.
  await expect(page.locator('.leaflet-proximity-pane path')).toHaveCount(2);
  // A new check clears the scan.
  await page.getByRole('button', { name: 'New search' }).click();
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.hit-list');
  await expect(page.locator('.leaflet-proximity-pane path')).toHaveCount(0);
  await expect(page.locator('.nearby-list')).toHaveCount(0);
});

test('the search panel collapses after a check and reopens on demand', async ({ page }) => {
  await expect(page.locator('.search-forms')).toBeVisible();
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.hit-list');

  await expect(page.locator('.search-forms')).toBeHidden();
  await expect(page.locator('.search-summary')).toBeVisible();
  await expect(page.locator('.search-summary-text')).toContainText('SW1A 1AA');

  await page.getByRole('button', { name: 'New search' }).click();
  await expect(page.locator('.search-forms')).toBeVisible();
  await expect(page.locator('#postcode-input')).toBeVisible();
});

test('a saved site can be re-checked and reports no changes', async ({ page }) => {
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.hit-list');

  await page.getByRole('button', { name: 'Save site' }).click();
  await expect(page.getByRole('button', { name: 'Saved ✓' })).toBeVisible();

  // Reopen the panel: the saved site is listed and re-checkable.
  await page.getByRole('button', { name: 'New search' }).click();
  await page.locator('.saved-sites > summary').click();
  await expect(page.locator('.saved-row')).toHaveCount(1);
  await expect(page.locator('.saved-label')).toContainText('SW1A 1AA');

  await page.getByRole('button', { name: 'Re-check' }).click();
  await page.waitForSelector('.recheck-section');
  // Same stubbed data → the snapshot diff is clean.
  await expect(page.locator('.recheck-clear')).toContainText('No changes since');

  // Deleting empties the list.
  await page.getByRole('button', { name: 'New search' }).click();
  await page.locator('.remove-saved').click();
  await expect(page.locator('.saved-row')).toHaveCount(0);
});

test('the overlay opacity slider scales the constraint layer styles', async ({ page }) => {
  await page.fill('#postcode-input', 'SW1A 1AA');
  await page.press('#postcode-input', 'Enter');
  await page.waitForSelector('.leaflet-overlay-pane path');

  await page.locator('.opacity-slider').evaluate((el) => {
    (el as HTMLInputElement).value = '0.3';
    el.dispatchEvent(new Event('input'));
  });
  // The conservation-area polygon (high tier, #c2510e) is scaled; the plain
  // location pin has no base fill and is untouched.
  await expect(page.locator('.leaflet-overlay-pane path[stroke="#c2510e"]').first()).toHaveAttribute('stroke-opacity', '0.3');
});

test('dark mode toggle flips the theme attribute', async ({ page }) => {
  const before = await page.locator('html').getAttribute('data-theme');
  await page.click('#theme-toggle');
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
});

test('coordinates outside Great Britain are rejected', async ({ page }) => {
  await page.fill('#lat-input', '48.85'); // Paris
  await page.fill('#lng-input', '2.35');
  await page.press('#lng-input', 'Enter');
  await expect(page.locator('.search-error')).toBeVisible();
});

test('a point with no English admin area errors as not in England', async ({ page }) => {
  await page.route('**www.planning.data.gov.uk/entity.json*', (route) =>
    route.fulfill({ json: { count: 0, entities: [] } }),
  );
  await page.locator('#map').click({ position: { x: 400, y: 300 } });
  await expect(page.locator('#report-root')).toContainText('not in England');
});
