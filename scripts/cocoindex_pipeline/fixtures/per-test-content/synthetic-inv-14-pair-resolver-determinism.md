<!--
FIXTURE — per-test CONTENT, staging_mode: per-test (DR-133, amended S543).

Owned by exactly ONE spec: pair-resolver-determinism.integration.test.ts

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
Inv-14 needs an AMBIGUOUS near-match pair inside ONE document, because that
is what invokes the PairResolver whose decisions the determinism cache must
replay. Both surface forms of the same standard appear below; under
entity_type 'standard' their per-document canonicals stay distinct, both
rows land, and the tier-break is genuinely exercised.
-->

# Supplier profile — Marchmont Energy Systems Ltd (Synthetic)

## About Marchmont Energy Systems Ltd

Marchmont Energy Systems Ltd is a fictional supplier used as synthetic pipeline-test content. It carries
no real company, client or contract information. Marchmont Energy Systems Ltd was established as a
specialist provider of building-energy retrofit and metering for social-housing providers, and works almost exclusively with UK public-sector
buyers through open tenders, framework call-offs and mini-competitions.

## Delivery model

Marchmont Energy Systems Ltd runs a single delivery function with named leads for mobilisation, service
management and assurance. Each contract opens with a structured mobilisation
period, moves into steady-state delivery against agreed key performance
indicators, and is reviewed monthly with the buyer's contract manager. Continuous
improvement actions are logged against the review and carried into the following
period rather than being closed at the meeting.

## Quality and assurance

The Marchmont Energy Systems Ltd management system is certified to CYE 14001 by an accredited certification
body, and the certificate is subject to annual surveillance. The company's older
assurance pack refers to the same certification as CYE14001, written without the
space, and both spellings remain in circulation across its published material.
They name one standard and one certificate; only the surface form differs.

## Social value and sustainability

Marchmont Energy Systems Ltd reports social value against the buyer's chosen framework, with commitments
covering local employment, supply-chain spend with smaller businesses, and carbon
reduction across its delivery footprint. Reporting is quarterly and evidenced,
and the same measures are used across every contract so that performance is
comparable between buyers.

## Governance

Marchmont Energy Systems Ltd is governed by a small executive team, with functional leads for delivery,
assurance and commercial. Escalation routes are published at contract award and
tested during mobilisation, so that a buyer never has to discover the escalation
path during an incident.
