-- Tag Management Sprint F: Singleton pruning
-- Removes low-value singleton AI keywords that provide no cross-referencing value.
--
-- Categories:
-- 1. Temporal phrases and time references
-- 2. Numeric codes without context
-- 3. Percentage/metric values
-- 4. Overly specific 4+ word phrases that are not proper nouns
-- 5. Generic single-word terms with zero discovery value

-- Temporal / time references
SELECT delete_tag('four to eight weeks', 'ai');
SELECT delete_tag('Monday to Friday', 'ai');
SELECT delete_tag('out-of-hours', 'ai');
SELECT delete_tag('support hours', 'ai');
SELECT delete_tag('working days', 'ai');
SELECT delete_tag('9am-5pm', 'ai');
SELECT delete_tag('72-hour reporting', 'ai');

-- Numeric codes without context
SELECT delete_tag('62012', 'ai');
SELECT delete_tag('63120', 'ai');
SELECT delete_tag('10 steps', 'ai');
SELECT delete_tag('12 principles', 'ai');

-- Percentage/metric values
SELECT delete_tag('99.9%', 'ai');
SELECT delete_tag('24/7', 'ai');

-- Generic terms with zero discovery value
SELECT delete_tag('reporting suite', 'ai');

-- Overly specific 4+ word phrases (not proper nouns or named standards)
SELECT delete_tag('persons of significant control', 'ai');
SELECT delete_tag('public sector digital products', 'ai');
SELECT delete_tag('rolling 30 day backup', 'ai');
SELECT delete_tag('EU Commission adequacy list', 'ai');
