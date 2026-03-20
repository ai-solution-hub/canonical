-- Tag Management Sprint A: One-time cleanup migration
-- Merges case-variation duplicates, plural/singular pairs, and removes invalid tags.
--
-- Uses existing merge_tags(source, target, type) and delete_tag(tag, type) RPCs.

-- =====================================================================
-- Step 1: Case-variation merges (10 groups)
-- Canonical form: proper nouns keep capitalisation, everything else lowercase
-- =====================================================================

-- "Agile" is a proper noun (methodology name)
SELECT merge_tags('agile', 'Agile', 'ai');

-- "audit system" — generic term, lowercase
SELECT merge_tags('Audit system', 'audit system', 'ai');

-- "Bitdefender" — proper noun (product name)
SELECT merge_tags('BitDefender', 'Bitdefender', 'ai');

-- "COVID-19 recovery" — COVID is an acronym
SELECT merge_tags('Covid-19 recovery', 'COVID-19 recovery', 'ai');

-- "data processing agreement" — generic, lowercase
SELECT merge_tags('Data Processing Agreement', 'data processing agreement', 'ai');

-- "data protection officer" — generic role, lowercase
SELECT merge_tags('Data Protection Officer', 'data protection officer', 'ai');

-- "Knowledge Academy" — proper noun (product/programme name)
SELECT merge_tags('knowledge academy', 'Knowledge Academy', 'ai');

-- "records of processing" — generic, lowercase
SELECT merge_tags('Records of Processing', 'records of processing', 'ai');

-- "virtual clinics" — generic, lowercase
SELECT merge_tags('Virtual Clinics', 'virtual clinics', 'ai');

-- "example-client"/"example-client" — company name as keyword is not useful; both deleted below

-- =====================================================================
-- Step 2: Plural/singular merges (18 pairs)
-- Keep singular form unless plural is the established term
-- =====================================================================

SELECT merge_tags('access controls', 'access control', 'ai');
SELECT merge_tags('action plans', 'action plan', 'ai');
SELECT merge_tags('admin users', 'admin user', 'ai');
SELECT merge_tags('advanced audits', 'advanced audit', 'ai');
SELECT merge_tags('audit trails', 'audit trail', 'ai');
SELECT merge_tags('background checks', 'background check', 'ai');
SELECT merge_tags('backups', 'backup', 'ai');
SELECT merge_tags('contracts', 'contract', 'ai');
SELECT merge_tags('contractors', 'contractor', 'ai');
SELECT merge_tags('data centres', 'data centre', 'ai');
SELECT merge_tags('DBS checks', 'DBS check', 'ai');
SELECT merge_tags('internal audits', 'internal audit', 'ai');
SELECT merge_tags('legal requirements', 'legal requirement', 'ai');
SELECT merge_tags('licence fees', 'licence fee', 'ai');
SELECT merge_tags('organisation types', 'organisation type', 'ai');
SELECT merge_tags('response times', 'response time', 'ai');
SELECT merge_tags('security audits', 'security audit', 'ai');
SELECT merge_tags('unique identifiers', 'unique identifier', 'ai');

-- =====================================================================
-- Step 3: Remove invalid tags
-- Monetary values and company names that are not useful as keywords
-- =====================================================================

SELECT delete_tag('£5,000,000', 'ai');
SELECT delete_tag('£10,000,000', 'ai');
SELECT delete_tag('£10 million', 'ai');
SELECT delete_tag('example-client', 'ai');
SELECT delete_tag('example-client', 'ai');
