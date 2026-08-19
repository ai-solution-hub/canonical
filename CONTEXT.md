# CONTEXT.md — Canonical domain glossary

The domain vocabulary for this repository. Definitions are validated against the platform
PRD (the private north-star document; top of the evidence-precedence chain) and are reused
verbatim wherever an entity-definition block is needed. Maintained via `/domain-modeling`;
architectural decisions live in `docs/adr/`.

## Knowledge model — three layers

Name the layer, never the aggregate: **sources** (evidence streams) → **records** (the
client database) → **concepts** (the map). "The client's knowledge base" refers to the
aggregate. **"corpus" is retired vocabulary** — it always blurred which layer was meant.

- **source binding** — a connection to an evidence stream: a watched localfs folder, a
  SharePoint/OneDrive or Google Drive connection, a Notion or HubSpot workspace, a
  WordPress wiki via export adapter, or a one-time handed-over document set. Carries
  connection config, a retention class, sync cursor/state, and its ingest trace. There is
  no publication gate at this boundary.
- **retention class** — the per-binding _policy choice about bytes_: keep-and-watch /
  ingest-once / live-connected / external-referenced. Never an architectural cornerstone.
- **ingest trace** — the slim per-item row keyed by (binding, logical locator — file path
  / URL / page-id), holding a content fingerprint and first/last-seen timestamps. Its only
  jobs: dedup, a provenance join target for records, and supplying the portable locator
  concept citations use. No state machine, no concept coupling, no identity minting.
- **concept map** — the OKF bundle as the curated map over knowledge, authored and
  maintained by humans and agents. Never derived per-document or per-record; includes the
  platform's self-description concepts. Trust lives in-band per OKF v0.2 (`status`,
  `stale_after`, `verified`, `sources[]`).
- **system bundle / client bundle** — the two bundle classes: the system bundle carries
  platform self-description, maintained by us and versioned with the platform; each client
  bundle carries that client's knowledge concepts and links to the system bundle.

## Records — core entities

- **application / application_type** — a use-case CLASS, realised as the reference table
  `application_types` (procurement, intelligence, sales_proposal, product_guide,
  competitor_research, training_onboarding). Not a container; there is no `applications`
  table. The layer above the retired workspace tier.
- **activity** — the unit that carries structured data and its own id: an engagement, a
  proposal, a guide. Records scope to the activity, never to a workspace.
- **engagement** — the activity kind where the client responds to a counterparty's ask:
  one procurement pursuit (the v1 instance; a sales-proposal pursuit is the plausible
  next). Carries its own id, `workflow_state`, `outcome`, `issuing_organisation`, and its
  procurement reference data (agreement, procedure type, regulation era, lot, CPV);
  anchors the pack versions and one or more submission events. Guides and other
  no-counterparty activities are not engagements. (Ruled S576, id-470 ADR 0013 — replaces
  "form" as the activity name.)
- **workspace** — LEGACY tier, removed from the containment chain. The `workspaces` table
  survives as migration-era infrastructure only; no new `*_workspaces` tables are ever
  minted. Never a synonym for client/tenant.
- **form** — a question-bearing document: the colloquial word for a **response document**.
  Never an activity (the activity is the **engagement** — ADR 0013 retired the old
  form-as-activity sense S576). "Form-shaped documents" and the **form structure map** —
  the LLM-assisted mapping of an unfamiliar form's layout to improve extraction — use this
  document sense. **"form type" is retired vocabulary**: activity classification lives in
  the procurement reference vocabulary; document genres are document roles.
- **pack** — the buyer-issued document set for a procurement as published: response
  document(s), instructions, specification, pricing schedules, appendices. A versioned
  artefact: a reissue mints a new pack version and the question-set diff between versions
  is derived. Pack members are classified at intake by the roles they play — response
  document / buyer-issued context / supplier evidence artefact — and a member may play
  more than one role.
- **submission event** — one competitive round within an engagement, carrying its own
  question set (extracted from the pack version in force for it) and deadline, and
  recording the submitted tender and its event-level outcome (shortlisted / not
  shortlisted / withdrawn). An engagement has one or more submission events; the
  assessment summary attaches to the submission event and rolls up to the engagement.
- **tender** — the supplier's submitted response at a submission event (the statutory
  word; assessment summaries reference "the tender"). "bid" is colloquial only and appears
  when quoting sources.
- **response document** — a question-bearing pack member ("form", colloquially): the only
  source questions are extracted from. Buyer-issued context members (instructions,
  specification, clarification Q&A logs) may source per-question constraints and
  amendments, never questions.
- **section** — a named division of a document: optional description, optional parent
  section (sub-sections), ordered. Questions belong to a section where the document has
  them; sections may carry evaluation context (scored vs non-scored, mandatory).
- **question** — extracted from response documents only, belonging to a section where one
  exists: question text (required), summary text, question advice, question hint, an
  enumerated question type (radio, checkboxes, text field, textarea, date, upload, …),
  answer options, follow-up question links, and its constraints (word/character limits,
  mandatory vs scored, pass/fail, required attachments, cross-reference permissibility).
- **response** — the working answer to one question within one engagement: status, owner,
  reviewer(s), deadline, version, response text, source of the initial draft (library /
  manual / suggested), drafted-by (human or agent), last-edited-by, approved-by.
  Engagement working state, never library state — pairs still mint ungated. An edit
  descending from a pair records its reason (edit-why capture).
- **q_a_pair** — the reusable knowledge unit and the Procurement anchor, reusable across
  applications. One client's shared library: never activity-partitioned; relevance is
  computed at query time via `scope_tag` overlap, not a scoping FK. Source-engagement
  provenance (document, question, response ids) is nullable provenance only.
- **evidence artefact** — a client-level dated evidence record: a certification, policy,
  insurance schedule, accounts, or CV. Typed, carrying expiry; citable and attachable from
  answers; reusable across activities. The answer text it backs is stable while the
  artefact itself dates — currency is computed from the expiry date, never a status.
  (First-class record kind ratified FINAL S576 — id-470 ADR 0010.)
- **assessment summary** — the statutory per-criterion feedback artefact every assessed
  tender receives: scores, written reasons referencing the tender's own text, and the
  winner's scores. Captured against the submission event and linked to the answers that
  produced each scored section.
- **reference_item** — an external-source item, continuously ingested (e.g. RSS) and
  primarily consumed by the Intelligence application. Citable, never authoritative on its
  own. Not a matching pool: question matching draws on `q_a_pairs` only. No publication
  status; `superseded_by` is the whole of its lifecycle.
- **tenant** — the client's database itself. One Supabase project per client; the database
  is the only tenant boundary; there is no `tenant_id` column anywhere. Legacy
  "cross-workspace" prose means within one client, never across clients.

## Procurement reference vocabulary (engagement metadata)

PA2023-first, PCR2015-aware — controlled vocabularies and reference metadata on the
engagement, not new record stores (id-470 ADR 0013, T2):

- **regulation era** — `PA2023 | PCR2015`; both eras' documents are live inputs, so past
  outcomes and assessments are processed under their own era's terms.
- **agreement** — the commercial vehicle (e.g. "G-Cloud 15"): agreement id (`RM6320`,
  dotted forms like `RM1043.9.2`), agreement type (open framework / closed framework /
  dynamic market / dynamic purchasing system / PCR15 framework), start/end dates, lots,
  suppliers. Nullable on the engagement — open-procedure tenders exist outside any
  agreement.
- **procedure type** — `open procedure | competitive flexible procedure` (PA2023); PCR2015
  equivalents recorded era-tagged.
- **lot** — the agreement subdivision an engagement targets; lots select question sets.
- **CPV code** — the standardised classification of an engagement's subject;
  classification metadata, never a filter gate.
- **outcome vocabulary, two levels** — submission-event outcome (shortlisted / not
  shortlisted / withdrawn) vs engagement outcome (awarded / not awarded / withdrawn /
  abandoned), plus award type (direct award, further competition, competitive award).
- **evaluation criteria / capability assessment** — the buyer's scoring frame and the
  supplier self-certification of capability; procurement-edge vocabulary feeding coverage
  and the assessment-summary link.

## Lifecycle and retrieval

- **observe-and-intervene** — the platform-wide write posture: a record exists or it
  doesn't. Versioned edits, post-hoc review, an audit trail — no promotion boundary, no
  publication state machine, no draft flags, for human and agent writes alike. Trust is
  visible (provenance, usage, verification events, freshness), never gated.
- **scope_tag** — the platform's only filter-shaped retrieval axis. Suggested at minting,
  corrected freely in curation, never `NOT NULL`; unscoped records stay retrievable and
  are flagged on the coverage surface, not blocked.
- **subject taxonomy** — display-level derived metadata, never a driver. The driving axes
  are scope (`scope_tag`), semantics (embeddings + keywords + entities; ranking, never an
  exclusion predicate), and concept membership (curated clusters).
- **view / layering** — the consumption-side meaning of "one record, many views": the same
  record rendered differently per audience and surface. A UI/consumption principle, not a
  claim that every fact has one canonical home.

## Containment

tenant (one DB per client) ⊃ applications (application_type) ⊃ activities (engagement /
proposal / guide, each with its own id) ⊃ their child records (pack ⊃ document ⊃ section ⊃
question ⊃ response; submission events); q_a_pairs and evidence artefacts are
client-level, not activity-partitioned. The workspace tier is retired from this chain.

## Retired vocabulary

Do not reintroduce: **corpus** (name the layer), **promotion / publication gate**
(observe-and-intervene replaced it), **`source_documents` as the ingestion spine**
(replaced by source bindings + the ingest trace), **per-document / residual concepts**
(concept grain is judgment), **`canonical://` URI scheme and row UUIDs in bundles**
(citations use portable external locators; platform surfaces are cited by linking to their
concept files), **anti-tags**, **workspace as a scoping tier**, **form as the name of the
activity** (the activity is the engagement — ADR 0013; "form" survives only in the
document sense), **form type** (activity classification lives in the procurement reference
vocabulary; document genres are document roles).
