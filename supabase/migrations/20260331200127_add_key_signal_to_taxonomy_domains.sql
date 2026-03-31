-- Add key_signal column to taxonomy_domains
-- Stores the editorial "key signal" text used by the classification prompt generator.
-- Previously hardcoded in scripts/generate-classification-prompt-taxonomy.ts.

ALTER TABLE taxonomy_domains ADD COLUMN IF NOT EXISTS key_signal text;

-- Populate from previously hardcoded KEY_SIGNALS map
UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about protecting information, systems, and data —
controls, policies, and security practices. The substance is about HOW security
is managed, not merely that a certification exists.' WHERE name = 'security';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about proving adherence to external requirements —
standards bodies, regulators, auditors. The focus is on the obligation or
evidence, not the underlying practice. For H&S, environmental, and modern
slavery subtopics, the signal is physical safety, environmental impact, or
ethical supply chain — not information security or data protection.' WHERE name = 'compliance';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about concrete delivery activities — what happens, when
it happens, and how the transition is managed. Answers the question "What do you
do to get the client live?"' WHERE name = 'implementation';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about keeping a live service running — BAU operations,
response commitments, and what happens when things go wrong. Answers the
question "How do you look after the service once it is live?"' WHERE name = 'support';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about the organisation itself — who you are, your track
record, your people, and your financial health. Answers the question "Tell us
about your company."' WHERE name = 'corporate';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about what the product or platform CAN do — its
capabilities, architecture, and user experience. Answers the question "What does
your system do?"' WHERE name = 'product-feature';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about HOW you work — your processes, governance, and
quality practices. Answers the question "What is your approach to delivering
projects?"' WHERE name = 'methodology';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about laws, statutory guidance, regulatory policy
updates, and legislative instruments. The substance is about WHAT THE LAW
SAYS or HOW POLICY IS CHANGING, not about how an organisation complies.
Answers the question "What does the legislation/guidance require?"' WHERE name = 'legislation-policy';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about competitors, market trends, procurement
activity, and commercial landscape. The substance is about the EXTERNAL
MARKET, not about the organisation''s own capabilities or products.
Answers the question "What is happening in our market?"' WHERE name = 'market-intelligence';

UPDATE taxonomy_domains SET key_signal = '**Key signal:** Content about sector events, leadership changes, inspections,
audits, and organisational restructuring in target sectors. The substance is
about WHAT IS HAPPENING in a sector, not about the organisation itself.
Answers the question "What is happening in the sectors we serve?"' WHERE name = 'sector-news';
