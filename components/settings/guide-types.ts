// ---------------------------------------------------------------------------
// Shared types and constants for guide settings components
// ---------------------------------------------------------------------------

export interface Guide {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  guide_type: string;
  domain_filter: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface GuideSection {
  id: string;
  guide_id: string;
  section_name: string;
  description: string | null;
  expected_layer: string | null;
  subtopic_filter: string | null;
  content_type_filter: string | null;
  display_order: number;
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

export const GUIDE_TYPE_LABELS: Record<string, string> = {
  sector: 'Sector',
  product: 'Product',
  company: 'Company',
  research: 'Research',
  custom: 'Custom',
};

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}
