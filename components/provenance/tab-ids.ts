export const PROVENANCE_TABS = [
  { id: 'per-item', label: 'Per-item', default: true },
  { id: 'pipeline-health', label: 'Pipeline Health', default: false },
  { id: 'audit', label: 'Audit', default: false },
  { id: 'cost', label: 'Cost', default: false, stub: true },
  { id: 'disputes', label: 'Disputes', default: false, stub: true },
] as const;

export type ProvenanceTabId = (typeof PROVENANCE_TABS)[number]['id'];
