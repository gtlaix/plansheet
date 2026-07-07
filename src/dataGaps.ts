/**
 * The data-gaps register: constraint classes a site appraisal needs that the
 * Planning Data platform does NOT cover (SPEC-06, Category A). Rendered in
 * every report so "no constraints found" is never read as "no constraints
 * exist". Verify entries against GET /dataset.json when touching this file —
 * when the platform gains a dataset covering a gap, delete the entry and add
 * the slug to the overlay in datasets.ts in the same change.
 */
export interface DataGap {
  id: string;
  topic: string;
  why: string;
  whereToCheck: string;
}

export const DATA_GAPS: DataGap[] = [
  { id: 'prow', topic: 'Public rights of way', why: 'A footpath or bridleway crossing a site can block development; diversions take months.', whereToCheck: 'Definitive map — county/unitary highway authority' },
  { id: 'commons', topic: 'Common land & town/village greens', why: 'Development on commons needs consent; village green registration defeats schemes.', whereToCheck: 'Commons register — commons registration authority' },
  { id: 'sssi-irz', topic: 'SSSI Impact Risk Zones', why: 'Natural England consultation is triggered well beyond SSSI boundaries.', whereToCheck: 'Natural England IRZ layer on magic.defra.gov.uk' },
  { id: 'surface-water', topic: 'Surface water flood risk', why: 'Flood zones here are rivers and sea only; surface water is the bigger risk on many urban sites.', whereToCheck: 'Environment Agency: Risk of Flooding from Surface Water maps' },
  { id: 'groundwater', topic: 'Groundwater source protection zones & aquifers', why: 'Constrain drainage design and contamination-sensitive uses.', whereToCheck: 'Environment Agency groundwater maps' },
  { id: 'contaminated-land', topic: 'Contaminated land & historic landfill', why: 'Remediation cost and liability.', whereToCheck: 'LPA Part 2A register; EA historic landfill data' },
  { id: 'mining', topic: 'Coal mining & mining legacy', why: 'Ground stability; Coal Authority permits may be needed.', whereToCheck: 'Coal Authority interactive map and mining reports' },
  { id: 'ground-stability', topic: 'Ground stability & radon', why: 'Foundation design and protective measures.', whereToCheck: 'BGS GeoIndex; UKHSA radon maps' },
  { id: 'highways', topic: 'Adopted highways & visibility splays', why: 'Access viability depends on highway extents and standards.', whereToCheck: 'Highway authority adopted-roads records' },
  { id: 'utilities', topic: 'Utilities & easements (sewers, mains, power, pipelines)', why: 'Build-over agreements and diversions affect layout and cost.', whereToCheck: 'Statutory undertakers’ asset searches' },
  { id: 'safeguarding-air', topic: 'Airport/aerodrome & MOD safeguarding zones', why: 'Height limits and consultation triggers.', whereToCheck: 'Safeguarding maps via the LPA, NATS and MOD' },
  { id: 'safeguarding-infra', topic: 'Major infrastructure safeguarding (e.g. HS2)', why: 'Safeguarding directions restrict what can be consented.', whereToCheck: 'DfT safeguarding directions; the LPA' },
  { id: 'hse', topic: 'HSE consultation zones (COMAH sites, pipelines)', why: 'HSE land-use planning advice can be decisive.', whereToCheck: 'HSE land-use planning portal' },
  { id: 'planning-history', topic: 'Planning history: permissions, conditions, s106, enforcement, appeals', why: 'The biggest gap — application data covers only pilot authorities.', whereToCheck: 'LPA planning register; PINS appeals casework portal' },
  { id: 'cil', topic: 'CIL charging schedules', why: 'Directly affects viability.', whereToCheck: 'LPA CIL pages' },
  { id: 'ecology', topic: 'Priority habitats, protected species, local wildlife sites', why: 'Ecology survey triggers and BNG baselines.', whereToCheck: 'MAGIC (priority habitats); local environmental records centre' },
  { id: 'ancient-trees', topic: 'Ancient & veteran trees', why: 'Irreplaceable-habitat policy applies beyond TPOs.', whereToCheck: 'Woodland Trust Ancient Tree Inventory' },
  { id: 'allocations', topic: 'Local plan site allocations & detailed policies map', why: 'Allocation status changes the appraisal entirely; the platform holds plan boundaries, not full allocations.', whereToCheck: 'LPA adopted policies map' },
  { id: 'neighbourhood-plans', topic: 'Neighbourhood plan policies', why: 'Made neighbourhood plans carry full development-plan weight.', whereToCheck: 'LPA / parish council' },
  { id: 'ownership', topic: 'Land ownership, covenants & easements', why: 'Deliverability; the platform holds parcel shapes, not title detail.', whereToCheck: 'HM Land Registry official copies' },
  { id: 'building-control', topic: 'Building Regulations, EPC, party wall', why: 'Separate consent regimes not covered by planning data.', whereToCheck: 'Local authority building control; EPC register' },
];
