import { entityPageUrl } from '../api/planningData';
import { CATEGORY_LABELS, classifyChecked, impactTier, TIER_LABELS } from '../datasets';
import { DATA_GAPS } from '../dataGaps';
import { reportToMarkdown } from './markdown';
import type { ReportData, ScoredHit } from '../types';

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
function exportButtons(data: ReportData): HTMLElement {
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

  const downloadBtn = el('button', { type: 'button', class: 'button button-secondary' }, 'Download .md');
  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([reportToMarkdown(data)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const slug = (data.selection.label ?? `${data.selection.lat},${data.selection.lng}`)
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const a = el('a', { href: url, download: `plansheet-${slug || 'report'}.md` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  return el('div', { class: 'report-actions' }, copyBtn, downloadBtn);
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
    ...(hit.detail ? [el('p', { class: 'hit-detail' }, el('strong', {}, 'This direction: '), hit.detail)] : []),
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
      el('h2', {}, 'PlanSheet'),
      el('p', { class: 'report-sub' }, data.selection.label ?? coords),
      el(
        'p',
        { class: 'report-meta' },
        `${coords}${data.nearestPostcode ? ` · nearest postcode ${data.nearestPostcode}` : ''} · generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      ),
      exportButtons(data),
    ),
  );

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
      dl.append(
        el('dt', {}, hit.registry.label),
        el(
          'dd',
          {},
          el('a', { href: entityPageUrl(hit.entity.entity), target: '_blank', rel: 'noopener' }, text),
        ),
      );
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
      el('ul', { class: 'hit-list' }, ...constraintHits.map(hitCard)),
    );
  } else {
    constraintSection.append(el('p', {}, 'No planning constraints or designations intersect this point.'));
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
    el('ul', {}, ...clear.map((c) => el('li', {}, c.label))),
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
