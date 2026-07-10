// id-118.12 (OQ-118-A option C, owner ratification S460): bare /provenance
// used to land admins on the per-item tab's empty UUID lookup form.
// pipeline-health is a populated, immediately-useful view with no required
// input, so it is the default; per-item stays reachable via ?tab=per-item.
export const PROVENANCE_TABS = [
  { id: 'per-item', label: 'Per-item', default: false },
  { id: 'pipeline-health', label: 'Pipeline Health', default: true },
  { id: 'audit', label: 'Audit', default: false },
  { id: 'cost', label: 'Cost', default: false, stub: true },
  { id: 'disputes', label: 'Disputes', default: false, stub: true },
] as const;

export type ProvenanceTabId = (typeof PROVENANCE_TABS)[number]['id'];
