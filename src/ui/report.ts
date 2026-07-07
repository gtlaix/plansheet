import { entityPageUrl } from '../api/planningData';
import { CATEGORY_LABELS, impactTier, TIER_LABELS } from '../datasets';
import type { LocationSelection, RegistryEntry, ScoredHit } from '../types';

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

export interface ReportData {
  selection: LocationSelection;
  nearestPostcode: string | null;
  /** Sorted hits: administrative first, then constraints by descending impact. */
  hits: ScoredHit[];
  /** Every dataset that was queried (for the affirmative "checked" record). */
  checked: RegistryEntry[];
  /** Dataset slugs whose query failed — these could NOT be checked. */
  failedDatasets: string[];
}

export function renderLoading(root: HTMLElement, label: string): void {
  root.replaceChildren(
    el('div', { class: 'report loading' }, el('p', {}, `Checking ${label}…`), el('div', { class: 'spinner' })),
  );
}

export function renderIdle(root: HTMLElement): void {
  root.replaceChildren(
    el(
      'div',
      { class: 'report idle' },
      el('p', {}, 'Search by postcode, coordinates or UPRN — or click the map — to generate a plan sheet of every planning constraint and designation on that location.'),
    ),
  );
}

export function renderError(root: HTMLElement, message: string): void {
  root.replaceChildren(el('div', { class: 'report' }, el('p', { class: 'search-error' }, message)));
}

function hitCard(hit: ScoredHit): HTMLElement {
  const tier = impactTier(hit.score);
  const name = String(hit.entity.name ?? '').trim();
  const title = name !== '' ? name : hit.entity.reference || `Entity ${hit.entity.entity}`;
  const meta: string[] = [];
  if (hit.entity.reference) meta.push(`Ref ${hit.entity.reference}`);
  if (hit.entity['start-date']) meta.push(`Since ${hit.entity['start-date']}`);

  return el(
    'li',
    { class: `hit tier-${tier}` },
    el(
      'div',
      { class: 'hit-head' },
      el('span', { class: `badge badge-${tier}` }, TIER_LABELS[tier]),
      el('span', { class: 'category-tag' }, CATEGORY_LABELS[hit.registry.category]),
    ),
    el(
      'h4',
      {},
      el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, title),
    ),
    el('p', { class: 'hit-dataset' }, hit.registry.label + (hit.qualifier ? ` — ${hit.qualifier}` : '')),
    ...(hit.registry.blurb ? [el('p', { class: 'hit-blurb' }, hit.registry.blurb)] : []),
    ...(meta.length > 0 ? [el('p', { class: 'hit-meta' }, meta.join(' · '))] : []),
  );
}

export function renderReport(root: HTMLElement, data: ReportData): void {
  const adminHits = data.hits.filter((h) => h.registry.category === 'administrative');
  const constraintHits = data.hits.filter((h) => h.registry.category !== 'administrative');

  const report = el('div', { class: 'report' });

  // --- Header ---
  const coords = `${data.selection.lat.toFixed(5)}, ${data.selection.lng.toFixed(5)}`;
  report.append(
    el(
      'div',
      { class: 'report-header' },
      el('h2', {}, 'Plan sheet'),
      el('p', { class: 'report-sub' }, data.selection.label ?? coords),
      el(
        'p',
        { class: 'report-meta' },
        `${coords}${data.nearestPostcode ? ` · nearest postcode ${data.nearestPostcode}` : ''} · generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      ),
      el('button', { type: 'button', class: 'button button-secondary print-button', onclick: () => window.print() }, 'Print / save as PDF'),
    ),
  );

  // --- 1. Administrative context ---
  const adminSection = el('section', { class: 'report-section' }, el('h3', {}, 'Administrative context'));
  if (adminHits.length > 0) {
    const dl = el('dl', { class: 'admin-list' });
    for (const hit of adminHits) {
      dl.append(
        el('dt', {}, hit.registry.label),
        el(
          'dd',
          {},
          el(
            'a',
            { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' },
            String(hit.entity.name ?? hit.entity.reference ?? hit.entity.entity),
          ),
        ),
      );
    }
    adminSection.append(dl);
  } else {
    adminSection.append(
      el('p', { class: 'hint' }, 'No administrative areas found — this location may be outside England, which is all the Planning Data platform covers.'),
    );
  }
  report.append(adminSection);

  // --- 2. Constraints ranked by impact ---
  const constraintSection = el(
    'section',
    { class: 'report-section' },
    el('h3', {}, `Constraints & designations (${constraintHits.length})`),
  );
  if (constraintHits.length > 0) {
    constraintSection.append(
      el('p', { class: 'hint' }, 'Ordered by likely impact on the planning potential of the site, greatest first.'),
      el('ul', { class: 'hit-list' }, ...constraintHits.map(hitCard)),
    );
  } else {
    constraintSection.append(el('p', {}, 'No planning constraints or designations intersect this point.'));
  }

  // Flood Zone 1 is the absence of a Zone 2/3 polygon — state it explicitly.
  const floodChecked = data.checked.some((c) => c.slug === 'flood-risk-zone') && !data.failedDatasets.includes('flood-risk-zone');
  const hasFloodHit = constraintHits.some((h) => h.registry.slug === 'flood-risk-zone');
  if (floodChecked && !hasFloodHit) {
    constraintSection.append(
      el('p', { class: 'flood-note' }, 'Flood risk: this point is not in Flood Zone 2 or 3, so it falls in Flood Zone 1 (low probability of river or sea flooding).'),
    );
  }
  report.append(constraintSection);

  // --- Failures, if any ---
  if (data.failedDatasets.length > 0) {
    report.append(
      el(
        'section',
        { class: 'report-section report-warning' },
        el('h3', {}, 'Could not be checked'),
        el('p', {}, `These datasets did not respond and are NOT included above: ${data.failedDatasets.join(', ')}. Re-run the check to retry.`),
      ),
    );
  }

  // --- 3. Affirmative record of everything checked with no hit ---
  const hitSlugs = new Set(data.hits.map((h) => h.registry.slug));
  const clear = data.checked.filter((c) => !hitSlugs.has(c.slug) && !data.failedDatasets.includes(c.slug));
  const details = el('details', { class: 'checked-list' });
  details.append(
    el('summary', {}, `Checked with no constraint found (${clear.length} datasets)`),
    el('ul', {}, ...clear.map((c) => el('li', {}, c.label))),
  );
  report.append(el('section', { class: 'report-section' }, details));

  root.replaceChildren(report);
}
