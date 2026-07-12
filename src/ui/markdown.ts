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
import { DATA_GAPS } from '../dataGaps';
import type { ReportData, ScoredHit } from '../types';

function hitTitle(hit: ScoredHit): string {
  const name = String(hit.entity.name ?? '').trim();
  if (name !== '') return name;
  if (hit.registry.slug === 'title-boundary') {
    return `Registered title (INSPIRE ${hit.entity.reference || hit.entity.entity})`;
  }
  return hit.entity.reference || `Entity ${hit.entity.entity}`;
}

/**
 * Render the plan sheet as a Markdown document, designed to be pasted straight
 * into another AI assistant (with an appraisal template) or a report. Mirrors
 * the on-screen report exactly.
 */
export function reportToMarkdown(data: ReportData): string {
  const coords = `${data.selection.lat.toFixed(5)}, ${data.selection.lng.toFixed(5)}`;
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines: string[] = [];

  lines.push(`# PlanSheet — ${data.selection.label ?? coords}`, '');
  if (data.site) lines.push(`- **Site area:** ${formatArea(data.site.areaM2)}`);
  lines.push(`- **${data.site ? 'Site centre' : 'Coordinates'}:** ${coords}`);
  if (data.nearestPostcode) lines.push(`- **Nearest postcode:** ${data.nearestPostcode}`);
  lines.push(`- **Generated:** ${today}`, '');

  const adminHits = data.hits.filter((h) => h.registry.category === 'administrative');
  const appHits = data.hits
    .filter((h) => h.registry.slug === PLANNING_APP_SLUG)
    .sort((a, b) => planningAppDate(b.entity).localeCompare(planningAppDate(a.entity)));
  const constraintHits = data.hits.filter(
    (h) => h.registry.category !== 'administrative' && h.registry.slug !== PLANNING_APP_SLUG,
  );

  // --- Administrative context ---
  lines.push('## Administrative context', '');
  if (adminHits.length > 0) {
    for (const hit of adminHits) {
      lines.push(`- **${hit.registry.label}:** ${hitTitle(hit)}`);
    }
  } else {
    lines.push('_No administrative areas found._');
  }
  lines.push('');

  // --- Constraints ranked by impact ---
  lines.push(`## Constraints & designations (${constraintHits.length})`, '');
  if (constraintHits.length > 0) {
    lines.push('_Ordered by likely impact on the planning potential of the site, greatest first._', '');
    for (const hit of constraintHits) {
      const tier = TIER_LABELS[impactTier(hit.score)];
      const qualifier = hit.qualifier ? ` — ${hit.qualifier}` : '';
      lines.push(`### ${hitTitle(hit)}${qualifier}`);
      lines.push(`- **Impact:** ${tier} · ${CATEGORY_LABELS[hit.registry.category]}`);
      lines.push(`- **Dataset:** ${hit.registry.label}`);
      if (hit.registry.blurb) lines.push(`- ${hit.registry.blurb}`);
      const cov = data.coverage?.get(hit.entity.entity);
      if (cov !== undefined) {
        lines.push(`- **Site coverage:** ${cov === null ? 'n/a (geometry could not be intersected)' : formatCoverage(cov)}`);
      }
      if (hit.detail) lines.push(`- **Removes:** ${hit.detail}`);
      if (hit.entity.reference) lines.push(`- **Reference:** ${hit.entity.reference}`);
      if (hit.entity['start-date']) lines.push(`- **Since:** ${hit.entity['start-date']}`);
      const org = hit.entity['organisation-entity'];
      if (typeof org === 'string' && org.trim() !== '') lines.push(`- **Organisation:** ${org}`);
      if (hit.entity['entry-date']) lines.push(`- **Data updated:** ${hit.entity['entry-date']}`);
      lines.push(`- **Source:** ${entityPageUrl(hit.entity.entity)}`, '');
    }
  } else {
    lines.push('No planning constraints or designations intersect this point.', '');
  }

  // --- Planning history ---
  if (appHits.length > 0) {
    lines.push(`## Planning history (${appHits.length} application${appHits.length === 1 ? '' : 's'})`, '');
    lines.push(
      '_Applications recorded on the Planning Data platform for this location, newest first. Only some ' +
        'LPAs publish here — this is **not** a complete planning history; verify on the LPA planning register._',
      '',
    );
    for (const hit of appHits) {
      const app = planningAppSummary(hit.entity);
      lines.push(`### ${app.name !== '' ? app.name : `Application ${app.reference}`}`);
      lines.push(`- **Reference:** ${app.reference}`);
      if (app.description) lines.push(`- **Proposal:** ${app.description}`);
      const statusBits = [app.appType, app.status].filter(Boolean).join(' · ');
      if (statusBits) lines.push(`- **Type/status:** ${statusBits}`);
      const decisionBits = [app.decision, app.decisionType].filter(Boolean).join(' — ');
      if (decisionBits || app.decisionDate) {
        lines.push(`- **Decision:** ${decisionBits || 'date only'}${app.decisionDate ? ` (${app.decisionDate})` : ''}`);
      }
      if (app.address) lines.push(`- **Address:** ${app.address}`);
      if (app.documentationUrl) lines.push(`- **Documents:** ${app.documentationUrl}`);
      lines.push(`- **Source:** ${entityPageUrl(hit.entity.entity)}`, '');
    }
  }

  // --- Nearby constraints (proximity scan) ---
  if (data.nearby) {
    const { radiusM, hits, skippedDense } = data.nearby;
    lines.push(`## Nearby constraints (within ${radiusM < 1000 ? `${radiusM} m` : `${radiusM / 1000} km`})`, '');
    lines.push(
      '_Constraints near — NOT on — the site. Distances are boundary-to-boundary and approximate._',
      '',
    );
    if (hits.length > 0) {
      for (const hit of hits) {
        const tier = TIER_LABELS[impactTier(hit.score)];
        const qualifier = hit.qualifier ? ` — ${hit.qualifier}` : '';
        lines.push(`- **${hitTitle(hit)}**${qualifier} (${hit.registry.label}) — ${formatDistance(hit.distanceM)} ${hit.bearing} · ${tier} · ${entityPageUrl(hit.entity.entity)}`);
      }
    } else {
      lines.push('- None found beyond the constraints on the site itself.');
    }
    if (skippedDense.length > 0) {
      lines.push('', `_Skipped on wide scans: ${skippedDense.join(', ')}._`);
    }
    lines.push('');
  }

  // --- Could not be checked ---
  if (data.failedDatasets.length > 0) {
    lines.push('## Could not be checked', '');
    lines.push(`These datasets did not respond and are **not** included above: ${data.failedDatasets.join(', ')}.`, '');
  }

  const { clear, partialNoData } = classifyChecked(data.checked, data.hits, data.failedDatasets);

  // --- No data found — coverage incomplete ---
  if (partialNoData.length > 0) {
    lines.push('## No data found — coverage incomplete', '');
    lines.push(
      'These datasets are supplied council-by-council and do not yet cover all of England. ' +
        'No data here does **not** mean no constraint — verify with the local planning authority.',
      '',
    );
    for (const c of partialNoData) lines.push(`- ${c.label}`);
    lines.push('');
  }

  // --- Checked, clear ---
  lines.push(`## Checked with no constraint found (${clear.length})`, '');
  for (const c of clear) lines.push(`- ${c.label}`);
  lines.push('');

  // --- Not covered by this check ---
  lines.push(`## Not covered by this check (${DATA_GAPS.length} topics)`, '');
  lines.push('The Planning Data platform does not hold these constraint classes — check them separately:', '');
  for (const g of DATA_GAPS) {
    lines.push(`- **${g.topic}:** ${g.why} _(Check: ${g.whereToCheck})_`);
  }
  lines.push('');

  return lines.join('\n');
}
