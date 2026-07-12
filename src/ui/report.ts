import { entityPageUrl } from '../api/planningData';
import {
  CATEGORY_LABELS,
  classifyChecked,
  impactTier,
  PLANNING_APP_SLUG,
  planningAppDate,
  planningAppSummary,
  TIER_LABELS,
} from '../datasets';
import { formatCoverage } from '../coverage';
import { formatArea, formatDistance } from '../geometry';
import { DEFAULT_RADIUS_M, RADIUS_PRESETS_M } from '../proximity';
import { DATA_GAPS } from '../dataGaps';
import { reportToMarkdown } from './markdown';
import { reportToJson } from './reportJson';
import type { NearbyHit, ReportData, ScoredHit } from '../types';

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

export type { ReportData } from '../types';

/** Build the "Copy Markdown" / "Download .md" export buttons for a report. */
function exportButtons(data: ReportData, handlers: ReportHandlers = {}): HTMLElement {
  const copyBtn = el('button', { type: 'button', class: 'button' }, 'Copy Markdown');
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(reportToMarkdown(data)).then(
      () => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied ✓';
        copyBtn.disabled = true;
        setTimeout(() => {
          copyBtn.textContent = original;
          copyBtn.disabled = false;
        }, 1600);
      },
      () => {
        copyBtn.textContent = 'Copy failed';
      },
    );
  });

  const fileSlug = (data.selection.label ?? `${data.selection.lat},${data.selection.lng}`)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const download = (ext: string, mime: string, content: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = el('a', { href: url, download: `plansheet-${fileSlug || 'report'}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const mdBtn = el('button', { type: 'button', class: 'button button-secondary' }, 'Download .md');
  mdBtn.addEventListener('click', () => download('md', 'text/markdown', reportToMarkdown(data)));

  const jsonBtn = el('button', { type: 'button', class: 'button button-secondary' }, 'Download JSON');
  jsonBtn.addEventListener('click', () => download('json', 'application/json', JSON.stringify(reportToJson(data), null, 2)));

  return el(
    'div',
    { class: 'report-actions' },
    copyBtn,
    mdBtn,
    jsonBtn,
    ...(handlers.onSave ? [saveButton(handlers.onSave)] : []),
  );
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
      el('p', {}, 'Search by postcode or coordinates — or click the map — to generate a PlanSheet of every planning constraint and designation on that location.'),
    ),
  );
}

export function renderError(root: HTMLElement, message: string): void {
  root.replaceChildren(el('div', { class: 'report' }, el('p', { class: 'search-error' }, message)));
}

// Fields shown elsewhere on the card, or not useful raw, are hidden from the
// detail disclosure; everything else primitive and non-empty is shown as-is.
const HIDDEN_DETAIL_FIELDS = new Set(['name', 'entity', 'typology', 'point', 'geometry', 'prefix']);

/** Ordered [label, value] rows of the raw entity fields, for the detail drawer. */
export function entityDetailRows(entity: Record<string, unknown>): [string, string][] {
  return Object.entries(entity)
    .filter(([k, v]) => !HIDDEN_DETAIL_FIELDS.has(k) && v != null && typeof v !== 'object' && String(v).trim() !== '')
    .map(([k, v]) => [k.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), String(v)]);
}

function hitCard(hit: ScoredHit, distanceLine?: string, coverageLine?: string, toggle?: HTMLElement): HTMLElement {
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
      el('span', { class: `badge badge-${tier}`, ariaLabel: `Impact rating: ${TIER_LABELS[tier]}` }, TIER_LABELS[tier]),
      el('span', { class: 'category-tag' }, CATEGORY_LABELS[hit.registry.category]),
      ...(distanceLine ? [el('span', { class: 'distance-tag' }, distanceLine)] : []),
      ...(toggle ? [toggle] : []),
    ),
    el(
      'h4',
      {},
      el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, title),
    ),
    el('p', { class: 'hit-dataset' }, hit.registry.label + (hit.qualifier ? ` — ${hit.qualifier}` : '')),
    ...(coverageLine ? [el('p', { class: 'hit-coverage' }, coverageLine)] : []),
    ...(hit.registry.blurb ? [el('p', { class: 'hit-blurb' }, hit.registry.blurb)] : []),
    ...(hit.detail ? [el('p', { class: 'hit-detail' }, el('strong', {}, 'Removes: '), hit.detail)] : []),
    ...(meta.length > 0 ? [el('p', { class: 'hit-meta' }, meta.join(' · '))] : []),
    hitDetails(hit),
  );
}

/**
 * One card for several pieces of the same designation (same dataset,
 * qualifier and score) — e.g. "Flood Zone 2 (3 areas)" — with a compact row
 * per piece and a single map toggle covering all of them.
 */
function groupedCard(group: ScoredHit[], data: ReportData, toggle?: HTMLElement): HTMLElement {
  const first = group[0];
  const tier = impactTier(first.score);
  const title = `${first.registry.label}${first.qualifier ? ` — ${first.qualifier}` : ''} (${group.length} areas)`;

  const members = el('ul', { class: 'group-members' });
  for (const hit of group) {
    const name = String(hit.entity.name ?? '').trim();
    const text = name !== '' ? name : hit.entity.reference || `Entity ${hit.entity.entity}`;
    const cov = data.coverage?.get(hit.entity.entity);
    members.append(
      el(
        'li',
        {},
        el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, text),
        ...(hit.entity.reference && name !== '' ? [el('span', { class: 'hit-meta' }, ` · Ref ${hit.entity.reference}`)] : []),
        ...(cov !== undefined && cov !== null ? [el('span', { class: 'hit-meta' }, ` · covers ${formatCoverage(cov)}`)] : []),
      ),
    );
  }

  return el(
    'li',
    { class: `hit tier-${tier}` },
    el(
      'div',
      { class: 'hit-head' },
      el('span', { class: `badge badge-${tier}`, ariaLabel: `Impact rating: ${TIER_LABELS[tier]}` }, TIER_LABELS[tier]),
      el('span', { class: 'category-tag' }, CATEGORY_LABELS[first.registry.category]),
      ...(toggle ? [toggle] : []),
    ),
    el('h4', {}, title),
    ...(first.registry.blurb ? [el('p', { class: 'hit-blurb' }, first.registry.blurb)] : []),
    members,
  );
}

/** Collapsible drawer of every raw entity field, without leaving the app. */
function hitDetails(hit: ScoredHit): HTMLElement {
  const rows = entityDetailRows(hit.entity);
  const dl = el('dl', { class: 'hit-fields' });
  for (const [label, value] of rows) dl.append(el('dt', {}, label), el('dd', {}, value));
  return el(
    'details',
    { class: 'hit-more' },
    el('summary', {}, 'All fields'),
    dl,
    el(
      'p',
      { class: 'hit-meta' },
      el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, 'View on planning.data.gov.uk ↗'),
    ),
  );
}

/** Optional interactions the host wires up (e.g. adopting a title boundary). */
export interface ReportHandlers {
  /** Re-run the check using an entity's geometry as the site boundary (SPEC-01). */
  onUseAsBoundary?: (entityId: number) => void;
  /** Run/re-run a proximity scan with the chosen radius (SPEC-04). */
  onScan?: (radiusM: number) => Promise<void>;
  /** Save this check (with a constraint snapshot) for later re-checking. */
  onSave?: () => void;
  /** Hide/show the geometry of these entities on the map (card eye toggle). */
  onToggleEntity?: (entityIds: number[], visible: boolean) => void;
}

/**
 * Group constraint hits that are the same designation in several pieces — same
 * dataset, qualifier and score (e.g. two "Flood Zone 2" polygons) — into one
 * card. Groups keep the position of their first (highest-ranked) member.
 */
export function groupConstraintHits(hits: ScoredHit[]): ScoredHit[][] {
  const groups = new Map<string, ScoredHit[]>();
  for (const hit of hits) {
    const key = `${hit.registry.slug}|${hit.qualifier ?? ''}|${hit.score}`;
    const list = groups.get(key) ?? [];
    list.push(hit);
    groups.set(key, list);
  }
  return [...groups.values()];
}

/** Eye toggle: hide/show a designation's geometry on the map. */
function mapToggle(entityIds: number[], onToggle: (ids: number[], visible: boolean) => void): HTMLElement {
  const btn = el('button', { type: 'button', class: 'hit-toggle' }, '👁');
  let visible = true;
  const sync = () => {
    btn.setAttribute('aria-pressed', String(visible));
    btn.setAttribute('aria-label', visible ? 'Hide on map' : 'Show on map');
    btn.title = visible ? 'Hide on map' : 'Show on map';
    btn.classList.toggle('is-hidden', !visible);
  };
  sync();
  btn.addEventListener('click', () => {
    visible = !visible;
    sync();
    onToggle(entityIds, visible);
  });
  return btn;
}

/** What changed since the saved snapshot (shown when re-checking a saved site). */
function recheckSection(recheck: NonNullable<ReportData['recheck']>): HTMLElement {
  const savedDate = new Date(recheck.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const section = el('section', { class: 'report-section recheck-section' });
  const { added, removed } = recheck;
  if (added.length === 0 && removed.length === 0) {
    section.append(el('p', { class: 'recheck-clear' }, `✓ No changes since this site was saved (${savedDate}).`));
    return section;
  }
  section.append(el('h3', {}, `Changes since saved (${savedDate})`));
  if (added.length > 0) {
    section.append(
      el('p', { class: 'recheck-added' }, el('strong', {}, `${added.length} new: `), added.map((a) => `${a.name || a.label} (${a.label})`).join('; ')),
    );
  }
  if (removed.length > 0) {
    section.append(
      el(
        'p',
        { class: 'recheck-removed' },
        el('strong', {}, `${removed.length} no longer returned: `),
        removed.map((r) => `${r.name || r.label} (${r.label})`).join('; ') +
          ' — the designation may have been withdrawn, or the record re-issued under a new identifier.',
      ),
    );
  }
  return section;
}

/** Radius selector + scan button + (when run) the nearby-constraints list. */
function proximitySection(data: ReportData, onScan: (radiusM: number) => Promise<void>): HTMLElement {
  const section = el('section', { class: 'report-section' }, el('h3', {}, 'Nearby constraints'));

  const select = el('select', { class: 'radius-select', id: 'radius-select' });
  for (const r of RADIUS_PRESETS_M) {
    const opt = el('option', { value: String(r) }, r < 1000 ? `${r} m` : `${r / 1000} km`);
    if (r === (data.nearby?.radiusM ?? DEFAULT_RADIUS_M)) opt.selected = true;
    select.append(opt);
  }
  const scanBtn = el('button', { type: 'button', class: 'button' }, data.nearby ? 'Re-scan' : 'Scan surroundings');
  scanBtn.addEventListener('click', () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';
    void onScan(Number(select.value)).finally(() => {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Re-scan';
    });
  });
  section.append(
    el(
      'div',
      { class: 'scan-controls' },
      el('label', { htmlFor: 'radius-select', class: 'field-label' }, 'Within'),
      select,
      scanBtn,
    ),
  );

  if (data.nearby) {
    const { radiusM, hits, skippedDense } = data.nearby;
    if (hits.length > 0) {
      section.append(
        el(
          'p',
          { class: 'hint' },
          `${hits.length} constraint${hits.length === 1 ? '' : 's'} within ${radiusM < 1000 ? `${radiusM} m` : `${radiusM / 1000} km`} of the ${data.site ? 'site boundary' : 'point'} — distances are boundary-to-boundary and approximate. These are NOT on the site.`,
        ),
        el(
          'ul',
          { class: 'nearby-list', ariaLabel: 'Nearby constraints, most significant first' },
          ...hits.map((h: NearbyHit) => hitCard(h, `${formatDistance(h.distanceM)} ${h.bearing}`)),
        ),
      );
    } else {
      section.append(el('p', {}, `No constraints found within ${radiusM} m (beyond those on the site itself).`));
    }
    if (skippedDense.length > 0) {
      section.append(
        el(
          'p',
          { class: 'hint' },
          `Skipped on wide scans (too dense to be useful): ${skippedDense.map((s) => s.replace(/-/g, ' ')).join(', ')}.`,
        ),
      );
    }
  } else {
    section.append(
      el('p', { class: 'hint' }, 'Find constraints near the site — a nearby SSSI, listed building or ancient woodland can trigger consultation or setting arguments even when it does not touch the site.'),
    );
  }
  return section;
}

/** "Save site" button for the report actions row. */
function saveButton(onSave: () => void): HTMLElement {
  const btn = el('button', { type: 'button', class: 'button button-secondary' }, 'Save site');
  btn.addEventListener('click', () => {
    onSave();
    btn.textContent = 'Saved ✓';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = 'Save site';
      btn.disabled = false;
    }, 1600);
  });
  return btn;
}

/** One planning application, as a history entry rather than a constraint. */
function planningAppCard(hit: ScoredHit): HTMLElement {
  const app = planningAppSummary(hit.entity);
  const title = app.name !== '' ? app.name : `Application ${app.reference}`;
  const statusBits = [app.appType, app.status].filter(Boolean).join(' · ');
  const decisionBits = [app.decision, app.decisionType].filter(Boolean).join(' — ');

  return el(
    'li',
    { class: 'hit app-card' },
    el(
      'h4',
      {},
      el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, title),
    ),
    el('p', { class: 'hit-dataset' }, `Ref ${app.reference}${statusBits ? ` · ${statusBits}` : ''}`),
    ...(app.description ? [el('p', { class: 'hit-blurb' }, app.description)] : []),
    ...(decisionBits
      ? [el('p', { class: 'hit-detail' }, el('strong', {}, 'Decision: '), decisionBits + (app.decisionDate ? ` (${app.decisionDate})` : ''))]
      : app.decisionDate
        ? [el('p', { class: 'hit-detail' }, el('strong', {}, 'Decision date: '), app.decisionDate)]
        : []),
    ...(app.address ? [el('p', { class: 'hit-meta' }, app.address)] : []),
    ...(app.startDate ? [el('p', { class: 'hit-meta' }, `Received/valid from ${app.startDate}`)] : []),
    ...(app.documentationUrl
      ? [
          el(
            'p',
            { class: 'hit-meta' },
            el('a', { href: app.documentationUrl, target: '_blank', rel: 'noopener' }, 'View application documents ↗'),
          ),
        ]
      : []),
    hitDetails(hit),
  );
}

export function renderReport(root: HTMLElement, data: ReportData, handlers: ReportHandlers = {}): void {
  const adminHits = data.hits.filter((h) => h.registry.category === 'administrative');
  const appHits = data.hits
    .filter((h) => h.registry.slug === PLANNING_APP_SLUG)
    .sort((a, b) => planningAppDate(b.entity).localeCompare(planningAppDate(a.entity)));
  const constraintHits = data.hits.filter(
    (h) => h.registry.category !== 'administrative' && h.registry.slug !== PLANNING_APP_SLUG,
  );

  const report = el('div', { class: 'report', role: 'region', ariaLabel: 'PlanSheet results' });

  // --- Header ---
  const coords = `${data.selection.lat.toFixed(5)}, ${data.selection.lng.toFixed(5)}`;
  report.append(
    el(
      'div',
      { class: 'report-header' },
      el('h2', {}, 'PlanSheet'),
      el('p', { class: 'report-sub' }, data.selection.label ?? coords),
      el(
        'p',
        { class: 'report-meta' },
        `${data.site ? 'Site centre ' : ''}${coords}${data.nearestPostcode ? ` · nearest postcode ${data.nearestPostcode}` : ''} · generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      ),
      ...(data.site ? [el('p', { class: 'report-area' }, el('strong', {}, 'Site area: '), formatArea(data.site.areaM2))] : []),
      exportButtons(data, handlers),
    ),
  );

  // --- 0. Re-check diff, when this run replays a saved site ---
  if (data.recheck) report.append(recheckSection(data.recheck));

  // --- 1. Administrative context ---
  const adminSection = el('section', { class: 'report-section' }, el('h3', {}, 'Administrative context'));
  if (adminHits.length > 0) {
    const dl = el('dl', { class: 'admin-list' });
    for (const hit of adminHits) {
      const name = String(hit.entity.name ?? '').trim();
      const text =
        name !== ''
          ? name
          : hit.registry.slug === 'title-boundary'
            ? `Registered title (INSPIRE ${hit.entity.reference || hit.entity.entity})`
            : String(hit.entity.reference || hit.entity.entity);
      const dd = el(
        'dd',
        {},
        el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, text),
      );
      // Adopt an HM Land Registry title boundary as the site to check (SPEC-01).
      if (hit.registry.slug === 'title-boundary' && handlers.onUseAsBoundary) {
        const useBtn = el('button', { type: 'button', class: 'button button-secondary button-inline' }, 'Use as site boundary');
        useBtn.addEventListener('click', () => {
          useBtn.disabled = true;
          useBtn.textContent = 'Loading boundary…';
          handlers.onUseAsBoundary!(hit.entity.entity);
        });
        dd.append(useBtn);
      }
      dl.append(el('dt', {}, hit.registry.label), dd);
    }
    adminSection.append(dl);
  } else {
    adminSection.append(el('p', { class: 'hint' }, 'No administrative areas returned for this point.'));
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
      el(
        'ul',
        { class: 'hit-list', ariaLabel: 'Constraints and designations, most significant first' },
        ...groupConstraintHits(constraintHits).map((group) => {
          const toggle = handlers.onToggleEntity
            ? mapToggle(group.map((h) => h.entity.entity), handlers.onToggleEntity)
            : undefined;
          if (group.length > 1) return groupedCard(group, data, toggle);
          const h = group[0];
          const cov = data.coverage?.get(h.entity.entity);
          const line =
            cov === undefined ? undefined : cov === null ? 'Coverage n/a (geometry could not be intersected)' : `Covers ${formatCoverage(cov)}`;
          return hitCard(h, undefined, line, toggle);
        }),
      ),
    );
  } else {
    constraintSection.append(
      el('p', {}, `No planning constraints or designations intersect this ${data.site ? 'site' : 'point'}.`),
    );
  }
  report.append(constraintSection);

  // --- 2a. Planning history: applications at this location ---
  // Planning history is central to a site's planning potential (what has been
  // applied for, granted or refused here), so it gets its own section rather
  // than a low-ranked constraint card.
  if (appHits.length > 0) {
    report.append(
      el(
        'section',
        { class: 'report-section' },
        el('h3', {}, `Planning history (${appHits.length} application${appHits.length === 1 ? '' : 's'})`),
        el(
          'p',
          { class: 'hint' },
          'Applications recorded on the Planning Data platform for this location, newest first. Only some LPAs publish applications here — this is NOT a complete planning history; verify on the LPA’s planning register.',
        ),
        el('ul', { class: 'app-list', ariaLabel: 'Planning applications, newest first' }, ...appHits.map(planningAppCard)),
      ),
    );
  }

  // --- 2b. Proximity scan (SPEC-04) ---
  if (handlers.onScan) report.append(proximitySection(data, handlers.onScan));

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
  // Partial-coverage datasets are LPA-sourced and nationally incomplete: a
  // zero-hit there is "no data found", never "no constraint" (ISSUES-3).
  const { clear, partialNoData } = classifyChecked(data.checked, data.hits, data.failedDatasets);

  if (partialNoData.length > 0) {
    report.append(
      el(
        'section',
        { class: 'report-section' },
        el('h3', {}, 'No data found — coverage incomplete'),
        el(
          'p',
          { class: 'hint' },
          'These datasets are supplied council-by-council and do not yet cover all of England. No data here does NOT mean no constraint — verify with the local planning authority.',
        ),
        el('ul', { class: 'partial-list' }, ...partialNoData.map((c) => el('li', {}, c.label))),
      ),
    );
  }

  const details = el('details', { class: 'checked-list' });
  details.append(
    el('summary', {}, `Checked with no constraint found (${clear.length} datasets)`),
    el(
      'ul',
      {},
      ...clear.map((c) => {
        const freshness: string[] = [];
        if (c.entityCount !== undefined) freshness.push(`${c.entityCount.toLocaleString('en-GB')} records`);
        if (c.dataDate) freshness.push(`data as of ${c.dataDate}`);
        return el('li', {}, c.label, ...(freshness.length ? [el('span', { class: 'freshness' }, ` — ${freshness.join(' · ')}`)] : []));
      }),
    ),
  );
  report.append(el('section', { class: 'report-section' }, details));

  // --- 4. What this check cannot cover at all ---
  const gaps = el('details', { class: 'checked-list gaps-list' });
  gaps.append(
    el('summary', {}, `Not covered by this check (${DATA_GAPS.length} topics)`),
    el(
      'p',
      { class: 'hint' },
      'The Planning Data platform does not hold these constraint classes. A full appraisal must check them separately:',
    ),
    el(
      'ul',
      {},
      ...DATA_GAPS.map((g) =>
        el('li', {}, el('strong', {}, `${g.topic}: `), `${g.why} `, el('em', {}, `Check: ${g.whereToCheck}`)),
      ),
    ),
  );
  report.append(el('section', { class: 'report-section' }, gaps));

  root.replaceChildren(report);
}
