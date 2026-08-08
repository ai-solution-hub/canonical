<!--
FIXTURE — per-test CONTENT, staging_mode: per-test (DR-133, amended S543).

Owned by exactly ONE spec: context-snippet-populated.integration.test.ts

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
Inv-17 asserts every produced entity_mentions row carries a non-empty
context_snippet. That is only observable over prose in which the mention's
surface form actually OCCURS — a snippet is the evidence the parent document
was genuinely read, which is what makes that document citable provenance
(producer/enrich.py). A blank extraction form, which is what this spec
staged until S543, has no such prose.
-->

# Supplier profile — Penhallow Digital Ltd (Synthetic)

## About Penhallow Digital Ltd

Penhallow Digital Ltd is a fictional supplier used as synthetic pipeline-test content. It carries
no real company, client or contract information. Penhallow Digital Ltd was established as a
specialist provider of service design and accessibility auditing for central-government departments, and works almost exclusively with UK public-sector
buyers through open tenders, framework call-offs and mini-competitions.

## Delivery model

Penhallow Digital Ltd runs a single delivery function with named leads for mobilisation, service
management and assurance. Each contract opens with a structured mobilisation
period, moves into steady-state delivery against agreed key performance
indicators, and is reviewed monthly with the buyer's contract manager. Continuous
improvement actions are logged against the review and carried into the following
period rather than being closed at the meeting.

## Quality and assurance

The Penhallow Digital Ltd management system is certified to SEC 27017 by an accredited certification
body, and the certificate is subject to annual surveillance and three-yearly
recertification. Scope covers the delivery functions named above. Evidence of
the current SEC 27017 certificate is issued to buyers at contract award and reissued
on renewal.

## Social value and sustainability

Penhallow Digital Ltd reports social value against the buyer's chosen framework, with commitments
covering local employment, supply-chain spend with smaller businesses, and carbon
reduction across its delivery footprint. Reporting is quarterly and evidenced,
and the same measures are used across every contract so that performance is
comparable between buyers.

## Governance

Penhallow Digital Ltd is governed by a small executive team, with functional leads for delivery,
assurance and commercial. Escalation routes are published at contract award and
tested during mobilisation, so that a buyer never has to discover the escalation
path during an incident.
