<!--
FIXTURE — per-test CONTENT, staging_mode: per-test (DR-133, amended S543).

Owned by exactly ONE spec: unresolved-mention-retains-canonical.integration.test.ts

Do NOT stage this document from a second spec, and do NOT copy its prose into a
new fixture. Identity in `source_documents` is content-hash FIRST, so two specs
staging identical bytes share one row: `storage_path` freezes to whichever
staged first, `filename` is overwritten by whichever staged last, and every
later staging memo-SKIPs and produces no rows at all. Nightly run 31271744240
had ten specs sharing one file and five of them failed out of the single row
that resulted. If you need a fixture, add one.

Distinct from every walked-baseline document in
`scripts/cocoindex_pipeline/fixtures/platform-corpus/` and from every other
fixture in this tree. The certification-shaped token(s) below are this file's
alone: the id-389 mock extractor echoes tokens matching [A-Z]{2,6} ?[0-9]{3,6}
verbatim, at their real offsets, and those echoes are the mentions these specs
observe. Changing a token here changes what its spec measures.

Why this spec needs prose rather than a blank extraction form:
Inv-20 needs an entity with NO near-match anywhere in the database, so that
resolve_entities returns None, the row keeps its per-document canonical, and
stage_counts.entity_resolution stays 0. The token below is deliberately unlike
every other token in every fixture tree and unlike every token in the walked
baseline. Do NOT add a second token to this file, and do NOT name another
fixture's token in this comment: the mock extractor scans the WHOLE converted
document including HTML comments, so a token written here as an example becomes
a mention, and this spec's assertion is precisely that its one mention has no
near-match. That mistake was made and caught while authoring this tree.
-->

# Supplier profile — Kilverstone Assurance Ltd (Synthetic)

## About Kilverstone Assurance Ltd

Kilverstone Assurance Ltd is a fictional supplier used as synthetic pipeline-test content.
It carries no real company, client or contract information. Kilverstone Assurance Ltd was
established as a specialist provider of independent verification and
certification-readiness advice for smaller suppliers, and works almost exclusively with UK
public-sector buyers through open tenders, framework call-offs and mini-competitions.

## Delivery model

Kilverstone Assurance Ltd runs a single delivery function with named leads for
mobilisation, service management and assurance. Each contract opens with a structured
mobilisation period, moves into steady-state delivery against agreed key performance
indicators, and is reviewed monthly with the buyer's contract manager. Continuous
improvement actions are logged against the review and carried into the following period
rather than being closed at the meeting.

## Quality and assurance

The Kilverstone Assurance Ltd management system is certified to QMX 88231 by an accredited
certification body, and the certificate is subject to annual surveillance and three-yearly
recertification. Scope covers the delivery functions named above. Evidence of the current
QMX 88231 certificate is issued to buyers at contract award and reissued on renewal.

## Social value and sustainability

Kilverstone Assurance Ltd reports social value against the buyer's chosen framework, with
commitments covering local employment, supply-chain spend with smaller businesses, and
carbon reduction across its delivery footprint. Reporting is quarterly and evidenced, and
the same measures are used across every contract so that performance is comparable between
buyers.

## Governance

Kilverstone Assurance Ltd is governed by a small executive team, with functional leads for
delivery, assurance and commercial. Escalation routes are published at contract award and
tested during mobilisation, so that a buyer never has to discover the escalation path
during an incident.
