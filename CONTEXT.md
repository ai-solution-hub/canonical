# CONTEXT.md — Canonical domain glossary

The domain vocabulary for this repository. Definitions are validated against the platform
PRD (the private north-star document; top of the evidence-precedence chain, as amended by
the S578 architecture-review rulings) and are reused verbatim wherever an
entity-definition block is needed. Maintained via `/domain-modeling`; architectural
decisions live in `docs/adr/`.

## Knowledge model — three layers

Name the layer, never the aggregate: **sources** (evidence streams) → **records** (the
client database) → **concepts** (the map). "The client's knowledge base" refers to the
aggregate.

- **source binding** — a connection to an evidence stream: a watched localfs folder, a
  SharePoint/OneDrive or Google Drive connection, a Notion or HubSpot workspace, a
  WordPress wiki via export adapter, a one-time handed-over document set, a manual upload
  channel, or an opportunity-scoped folder the bid team keeps for one pursuit. Carries
  connection config, a retention class, sync cursor/state, and its ingest trace. There is
  no publication gate at this boundary.
- **retention class** — the per-binding _policy choice about bytes_: keep-and-watch /
  ingest-once / live-connected / external-referenced.
- **ingest trace** — the slim per-item row keyed by (binding, logical locator — file path
  / URL / page-id / storage object), holding a content fingerprint and first/last-seen
  timestamps. Every ingested item has one, whichever channel it arrived by; it is the only
  locator and provenance path for bytes. Its jobs: dedup, a provenance join target for
  records, and supplying the portable locator concept citations use. No state machine, no
  concept coupling, no identity minting.
- **concept map** — the OKF bundle as the curated map over knowledge, authored and
  maintained by humans and agents, derived from company knowledge sources, including the
  Canonical platform. Trust lives in-band per OKF v0.2 (`status`, `stale_after`,
  `verified`, `sources[]`).
- **system bundle / client bundle** — the two bundle classes: the system bundle carries
  platform self-description, maintained by us and versioned with the platform; each client
  bundle carries that client's knowledge concepts, its curated domain vocabulary as the
  bundle's ontology overlay, and links to the system bundle.
- **domain vocabulary** — the client's own terms: the entities their sources talk about,
  the labels they use for them, their kinds, and the predicates that relate them. Learned
  from the client's sources, corrected by the client's people, emitted into the client
  bundle. _Avoid_: taxonomy (display-level), ontology (the emitted formal form, not the
  living vocabulary).

## Records — parties

- **organisation** — a party the client deals with, or the client itself: a prospect,
  customer, buyer, partner, subcontractor, competitor or supplier. One record per
  real-world organisation whatever roles it plays over time; may belong to a parent
  organisation (a directorate, a trust, a group). _Avoid_: client (ambiguous with the
  tenant), issuing organisation, account.
- **relationship** — the client's standing with an organisation at a point in time:
  prospect, customer, former customer, buyer, partner, subcontractor, competitor,
  supplier. Dated and multi-valued — an organisation can be a customer and a subcontractor
  at once. Core values ship; clients add their own.
- **contact** — a person at an organisation (or not yet attached to one), with a role: the
  people that meetings, approaches and packs name. Business-contact data, never egressed
  raw.
- **tenant** — the client's database itself. One Supabase project per client; the database
  is the only tenant boundary; there is no `tenant_id` column anywhere. Never a synonym
  for organisation: the client's own organisation is the one organisation record marked as
  self. Legacy "cross-workspace" prose means within one client, never across clients.

## Records — opportunities

- **opportunity** — the client's pursuit of work with a party, from the first signal to
  the recorded outcome, whoever initiates it: targeting, an approach, a proposal, a tender
  response. Carries its own id, workflow state, outcome and counterparty; anchors the pack
  versions and one or more submission events. What an opportunity _is_ is given by its
  facets, never by a stored kind. _Avoid_: engagement (retired as the anchor word —
  professional services use it for delivered work, PA2023 for pre-tender dialogue),
  project (delivered work), pursuit, deal, bid.
- **facet** — a one-to-one extension of an opportunity that says what kind of pursuit it
  has become: a procurement facet when a tender exists; a proposal facet when the sales
  application lands. An opportunity may gain facets over its life.
- **procurement (facet)** — the procurement-process facts of an opportunity: regulation
  era, agreement and lot, procedure type, CPV codes, notice references, portal, and the
  contracting authority where it differs from the counterparty. A re-procurement of the
  same need is a new opportunity with the same organisation.
- **workflow state** — the opportunity's external position: targeting → approached →
  preparing → submitted → outcome recorded, or withdrawn. Each value marks a fact about
  the world, never an internal approval stage; finer display states derive from submission
  events and outcomes.
- **application** — a lens: a code surface (web routes and agent skills) that works over
  records by facet — procurement, intelligence, sales, marketing. Applications are not
  records, do not type records, and have no table. _Avoid_: application type, workspace.
- **pack** — the buyer-issued document set for a procurement as published: response
  document(s), instructions, specification, pricing schedules, appendices. A versioned
  artefact: a reissue mints a new pack version and the question-set diff between versions
  is derived. A new version is proposed when a member's fingerprint changes and is always
  confirmed by a person, never minted silently. Pack members are classified at intake by
  the roles they play — response document / buyer-issued context / supplier evidence
  artefact — and a member may play more than one role.
- **submission event** — one competitive round within an opportunity, carrying its own
  question set (extracted from the pack version in force for it) and deadline, and
  recording the submitted tender and its event-level outcome (shortlisted / not
  shortlisted / withdrawn). An opportunity has one or more submission events; the
  assessment summary attaches to the submission event and rolls up to the opportunity.
- **tender** — the supplier's submitted response at a submission event (the statutory
  word; assessment summaries reference "the tender"). "bid" is colloquial only and appears
  when quoting sources.
- **response document** — a question-bearing pack member ("form", colloquially): the only
  source questions are extracted from. Buyer-issued context members (instructions,
  specification, clarification Q&A logs) may source per-question constraints and
  amendments, never questions.
  - **form** — the colloquial word for a question-bearing document: "Form-shaped
    documents" and the **form structure map** — the LLM-assisted mapping of an unfamiliar
    form's layout to improve extraction — use this document sense.
- **reference question set** — a published standard question corpus (the Common Assessment
  Standard, the PPN 03/24 Standard Selection Questionnaire) held as a document with
  sections and questions, versioned by its publisher and bound to no pack. A pack question
  may instantiate a standard question; the client's standing answers to the set are Q&A
  pairs.
- **section** — a named division of a document: optional description, optional parent
  section (sub-sections), ordered. Questions belong to a section where the document has
  them; sections may carry evaluation context (scored vs non-scored, mandatory).
- **question** — extracted from response documents only, belonging to a section where one
  exists: question text (required), summary text, question advice, question hint, an
  enumerated question type (radio, checkboxes, text field, textarea, date, upload, …),
  answer options, follow-up and exemption links, its constraints (word/character limits,
  mandatory vs scored, pass/fail, required attachments, cross-reference permissibility),
  and — for a standard question — its obligation class and the standard question a pack
  question instantiates.
- **response** — the working answer to one question within one opportunity: status, owner,
  reviewer(s), deadline, version, response text, source of the initial draft (library /
  manual / suggested), drafted-by (human or agent), last-edited-by, approved-by.
  Opportunity working state, never library state — pairs still mint ungated. An edit
  descending from a pair records its reason (edit-why capture).

## Records — knowledge (client-level, never partitioned)

- **q_a_pair** — the reusable knowledge unit and the Procurement anchor, reusable across
  applications. One client's shared library: never partitioned by opportunity or
  application. Source-opportunity provenance (document, question, response ids) is
  nullable provenance only.
- **evidence artefact** — a client-level dated evidence record: a certification, policy,
  insurance schedule, accounts, or CV. Typed, carrying expiry; citable and attachable from
  answers; reusable across opportunities. The answer text it backs is stable while the
  artefact itself dates — currency is computed from the expiry date, never a status.
- **assessment summary** — the statutory per-criterion feedback artefact every assessed
  tender receives: scores, written reasons referencing the tender's own text, and the
  winner's scores. Captured against the submission event and linked to the answers that
  produced each scored section.
- **entity** — a thing the client's sources talk about — an organisation, person,
  certification, regulation, framework, technology, product, standard, … — held once with
  a preferred label, its variants and its kind. Where a typed record exists (an
  organisation, a contact, an evidence artefact) the entity is its twin. Learned from
  sources, corrected by people; a rejected merge stays rejected.
- **label** — one way the client's sources name an entity: the preferred label or a
  variant (synonym, acronym, misspelling), each with how often it is used. Variants fold
  to the preferred label at extraction; the raw form is kept on the mention.
- **kind** — the class of an entity. Core kinds ship with the platform; clients add their
  own.
- **predicate** — a named relation between entities ("holds", "delivers to", "complies
  with") with its own variants — the client's relationship vocabulary, learned and curated
  like labels. _Avoid_: relationship type, edge.
- **mention** — one place a source names an entity: the raw surface form, where it was
  seen, and the extraction's evidence. Evidence lives on the mention — never a state on
  the entity, never trust on a concept.
- **signal** — an external-source item, continuously ingested (e.g. RSS) and primarily
  consumed by the Intelligence application, targeted at organisations and topics the
  client watches. Citable, never authoritative on its own; not a matching pool. No
  publication status; `superseded_by` is the whole of its lifecycle. _Avoid_: opportunity
  (reserved for the pursuit), reference item (the legacy name).

## Procurement reference vocabulary (procurement-facet metadata)

PA2023-first, PCR2015-aware — controlled vocabularies and reference metadata on the
procurement facet, not new record stores:

- **regulation era** — `PA2023 | PCR2015`; both eras' documents are live inputs, so past
  outcomes and assessments are processed under their own era's terms.
- **agreement** — the commercial vehicle (e.g. "G-Cloud 15"): agreement id (`RM6320`,
  dotted forms like `RM1043.9.2`), agreement type (open framework / closed framework /
  dynamic market / dynamic purchasing system / PCR15 framework), start/end dates, lots,
  suppliers. Nullable on the facet — open-procedure tenders exist outside any agreement.
- **procedure type** — `open procedure | competitive flexible procedure` (PA2023); PCR2015
  equivalents recorded era-tagged.
- **lot** — the agreement subdivision an opportunity targets; lots select question sets.
- **CPV code** — the standardised classification of a procurement's subject;
  classification metadata, never a filter gate.
- **outcome vocabulary, two levels** — submission-event outcome (shortlisted / not
  shortlisted / withdrawn) vs opportunity outcome (awarded / not awarded / withdrawn /
  abandoned), plus award type (direct award, further competition, competitive award).
- **evaluation criteria / capability assessment** — the buyer's scoring frame and the
  supplier self-certification of capability; procurement-edge vocabulary feeding coverage
  and the assessment-summary link.
- **preliminary market engagement** — PA2023's pre-tender dialogue between buyers and
  suppliers; a stage an opportunity passes through (approached), never the anchor.

## Lifecycle, provenance and retrieval

- **observe-and-intervene** — the platform-wide write posture: a record exists or it
  doesn't. Versioned edits, post-hoc review, an audit trail — no promotion boundary, no
  publication state machine, no draft flags, for human and agent writes alike. Trust is
  visible (provenance, usage, verification events, freshness), never gated. Applies to the
  domain vocabulary too: proposals are visible and correctable, never gates.
- **actor** — who or what performed a write or a verification: a person, a named agent
  with its version, or a process — one convention shared by records and the concept map.
  Trust tiers derive from verification events and are never stored.
- **scope_tag** — the platform's only filter-shaped retrieval axis. Suggested at minting,
  corrected freely in curation, never `NOT NULL`; unscoped records stay retrievable and
  are flagged on the coverage surface, not blocked.
- **subject taxonomy** — display-level derived metadata, never a driver. The driving axes
  are scope (`scope_tag`), semantics (embeddings + labels + entities; ranking, never an
  exclusion predicate), and concept membership (curated clusters).
- **view / layering** — the consumption-side meaning of "one record, many views": the same
  record rendered differently per audience and surface. A UI/consumption principle, not a
  claim that every fact has one canonical home.
- **workspace** — LEGACY tier, removed from the containment chain. The `workspaces` table
  survives as migration-era infrastructure only; no new `*_workspaces` tables are ever
  minted. Never a synonym for client/tenant.

## Containment

tenant (one DB per client) ⊃ parties (organisations, relationships, contacts) ·
opportunities (+ facets) ⊃ their child records (pack ⊃ document ⊃ section ⊃ question ⊃
response; submission events; milestones) · knowledge (Q&A pairs, evidence artefacts,
entities / labels / predicates) · content (guides) · signals · bindings + ingest trace.
Applications are lenses over any of it; nothing is contained by an application. The
workspace and activity tiers are retired from this chain.

## Retired vocabulary

Do not reintroduce: **corpus** (name the layer), **promotion / publication gate**
(observe-and-intervene replaced it), **`source_documents` as the ingestion spine**
(replaced by source bindings + the ingest trace), **per-document / residual concepts**
(concept grain is judgment), **`canonical://` URI scheme and row UUIDs in bundles**
(citations use portable external locators; platform surfaces are cited by linking to their
concept files), **anti-tags**, **workspace as a scoping tier**, **activity as a tier**
(the pursuit anchor is the opportunity; guides are content), **engagement as the anchor
word** (survives only inside "preliminary market engagement"), **form as the name of the
activity**, **form type** (document genres are document roles), **application type as a
table or column** (applications are lenses), **issuing organisation** (the counterparty is
an organisation), **a `clients` table** (the client's customers are organisations with a
customer relationship).
