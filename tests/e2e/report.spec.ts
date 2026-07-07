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
  ],
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
  await page.route('**www.planning.data.gov.uk/entity.geojson*', (route) =>
    route.fulfill({ json: route.request().url().includes('dataset=border') ? BORDER_GEOJSON : GEOJSON }),
  );
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
});

test('the map is keyboard-operable: Enter checks the centre', async ({ page }) => {
  await page.locator('#map').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hit-list')).toBeVisible();
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
