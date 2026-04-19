-- Cutover residual fix (S182 WP1 parity checks)
--
-- After re-ingestion onto the new project, the Coverage → Guides tab
-- showed two regressions surfaced by the screenshot parity audit:
--
--   1. Three Product Guides (LMS, Websites, Advanced Audits) rendered
--      0/19 populated sections because their `domain_filter` still
--      referenced `products-services` — a Client-tagged category that
--      carries zero items post-reingest. Content that used to sit under
--      `products-services` was reclassified to the active
--      `product-feature` domain during the Stage 1+2 re-ingestion arc.
--
--   2. The `MAT Auditing Intelligence Guide` row (guide_id
--      d42b2651-5f71-4ce5-931d-3f0755ad193d) was missing entirely on
--      the new project, together with its 12 sections. The row existed
--      on the retiring project and was lost during one of the manual
--      guide refresh passes; the audit trail for that drop is unclear,
--      so this migration restores the canonical shape verbatim.
--
-- Both changes are data-only (DML). Fully reversible via inverse
-- UPDATE/DELETE against the preserved UUIDs.

-- Fix 1: repoint the three Product Guides at the active product domain.
UPDATE guides
   SET domain_filter = 'product-feature',
       updated_at = NOW()
 WHERE slug IN ('lms-product', 'websites-product', 'audits-product');

-- Fix 2: restore the MAT Auditing Intelligence Guide row.
INSERT INTO guides (
    id,
    name,
    slug,
    guide_type,
    domain_filter,
    description,
    display_order,
    is_published,
    created_at,
    updated_at
)
VALUES (
    'd42b2651-5f71-4ce5-931d-3f0755ad193d',
    'MAT Auditing Intelligence Guide',
    'intelligence-mat-auditing',
    'research',
    NULL,
    'Auto-generated intelligence coverage guide for Example Client Ltd',
    0,
    TRUE,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Fix 2b: restore the 12 sections attached to that guide, UUIDs and
-- display_order preserved from the retiring project so that any code
-- holding a section-id reference continues to work.
INSERT INTO guide_sections (
    id,
    guide_id,
    section_name,
    description,
    expected_layer,
    subtopic_filter,
    content_type_filter,
    display_order,
    is_required,
    parent_section_id
)
VALUES
    ('cb5dce3b-fb69-4f69-9ab3-0bd1e4321b90', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'education',                    'Intelligence coverage for the education sector',           'research', NULL, 'article',  1, TRUE,  NULL),
    ('069107bc-334e-4516-8759-f45f713d8e15', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'safeguarding',                 'Intelligence coverage for the safeguarding sector',        'research', NULL, 'article',  2, TRUE,  NULL),
    ('0f10e136-5827-4d09-b927-764e462f5560', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'health-audit',                 'Intelligence coverage for the health-audit sector',        'research', NULL, 'article',  3, TRUE,  NULL),
    ('e0ffce9a-755a-46ce-b29a-ab80b8ea43d9', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'social-care',                  'Intelligence coverage for the social-care sector',         'research', NULL, 'article',  4, TRUE,  NULL),
    ('2d11fb47-ac1f-4239-8076-a251011b4093', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'kcsie',                        'Articles and updates related to kcsie',                    'research', NULL, 'article',  5, FALSE, NULL),
    ('ddc503cc-0ecf-4065-81d7-d025fc15755b', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'mat-restructuring',            'Articles and updates related to mat-restructuring',        'research', NULL, 'article',  6, FALSE, NULL),
    ('4fe92562-7fd0-466b-a94e-86c842130db5', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'ofsted-inspection-framework',  'Articles and updates related to ofsted-inspection-framework','research', NULL, 'article',  7, FALSE, NULL),
    ('90ee3772-bf1d-4c4e-92ac-374f41c8e575', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'safeguarding-audit',           'Articles and updates related to safeguarding-audit',       'research', NULL, 'article',  8, FALSE, NULL),
    ('0f096a9a-bb31-473a-810f-14b10a5a9faf', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'education-act',                'Articles and updates related to education-act',            'research', NULL, 'article',  9, FALSE, NULL),
    ('6dd76d75-ed93-4983-9836-d57949dcf16d', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'health-audit-standards',       'Articles and updates related to health-audit-standards',   'research', NULL, 'article', 10, FALSE, NULL),
    ('6236df19-88ba-4155-b073-e91cbcbeb68a', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'cpd-requirements',             'Articles and updates related to cpd-requirements',         'research', NULL, 'article', 11, FALSE, NULL),
    ('63ca989e-b269-4186-ae64-ed7cdb55b814', 'd42b2651-5f71-4ce5-931d-3f0755ad193d', 'Research Feed',                'General intelligence articles not matching a specific section','research', NULL, NULL,      12, FALSE, NULL)
ON CONFLICT (id) DO NOTHING;
