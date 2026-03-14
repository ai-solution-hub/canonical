-- Add example-client Design client-specific taxonomy domains
-- These map to the guide definitions seeded by scripts/seed-example-client-guides.ts
-- Provenance: 'client' (not baseline — these are client-specific domains)

INSERT INTO taxonomy_domains (name, display_order, colour, is_active, description, provenance)
VALUES
  ('Safeguarding & Child Protection', 8, 'security', true,
   'Safeguarding children and young people — KCSIE, DBS, SCR, DSL roles, safer recruitment, and child protection policies.', 'client'),
  ('Safeguarding Adults', 9, 'compliance', true,
   'Adult safeguarding — SAB statutory duties, Making Safeguarding Personal, Care Act compliance, and vulnerable adult protection.', 'client'),
  ('Multi-Academy Trusts', 10, 'implementation', true,
   'MAT governance, central services, school improvement, trust-wide compliance, and multi-site safeguarding.', 'client'),
  ('Education', 11, 'methodology', true,
   'Education sector — schools, colleges, universities, Ofsted, DfE requirements, and education technology.', 'client'),
  ('Products & Services', 12, 'product', true,
   'example-client Design product portfolio — LMS, Websites, Advanced Audits, and associated services.', 'client')
ON CONFLICT (name) DO NOTHING;
