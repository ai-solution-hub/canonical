# CONTEXT.md — Canonical domain glossary

The domain vocabulary for this repository. Definitions are validated against the
platform PRD (the private north-star document; top of the evidence-precedence chain)
and are reused verbatim wherever an entity-definition block is needed. Maintained via
`/domain-modeling`; architectural decisions live in `docs/adr/`.

## Knowledge model — three layers

Name the layer, never the aggregate: **sources** (evidence streams) → **records**
(the client database) → **concepts** (the map). "The client's knowledge base" refers
to the aggregate. **"corpus" is retired vocabulary** — it always blurred which layer
was meant.

- **source binding** — a connection to an evidence stream: a watched localfs folder, a
  SharePoint/OneDrive or Google Drive connection, a Notion or HubSpot workspace, a
  WordPress wiki via export adapter, or a one-time handed-over document set. Carries
  connection config, a retention class, sync cursor/state, and its ingest trace. There
  is no publication gate at this boundary.
- **retention class** — the per-binding *policy choice about bytes*: keep-and-watch /
  ingest-once / live-connected / external-referenced. Never an architectural
  cornerstone.
- **ingest trace** — the slim per-item row keyed by (binding, logical locator — file
  path / URL / page-id), holding a content fingerprint and first/last-seen timestamps.
  Its only jobs: dedup, a provenance join target for records, and supplying the
  portable locator concept citations use. No state machine, no concept coupling, no
  identity minting.
- **concept map** — the OKF bundle as the curated map over knowledge, authored and
  maintained by humans and agents. Never derived per-document or per-record; includes
  the platform's self-description concepts. Trust lives in-band per OKF v0.2
  (`status`, `stale_after`, `verified`, `sources[]`).
- **system bundle / client bundle** — the two bundle classes: the system bundle
  carries platform self-description, maintained by us and versioned with the platform;
  each client bundle carries that client's knowledge concepts and links to the system
  bundle.

## Records — core entities

- **application / application_type** — a use-case CLASS, realised as the reference
  table `application_types` (procurement, intelligence, sales_proposal, product_guide,
  competitor_research, training_onboarding). Not a container; there is no
  `applications` table. The layer above the retired workspace tier.
- **activity** — the unit that carries structured data and its own id: a form, a
  proposal, a guide. Records scope to the activity, never to a workspace.
- **workspace** — LEGACY tier, removed from the containment chain. The `workspaces`
  table survives as migration-era infrastructure only; no new `*_workspaces` tables
  are ever minted. Never a synonym for client/tenant.
- **form** — a submission/questionnaire instance (`form_instances` row of a
  `form_type`) — the procurement activity itself, carrying its own `workflow_state`,
  `outcome`, `deadline`, `submission_date`, `issuing_organisation`. Forms are manual
  upload only, never on an ingestion walk path. "bid" is a legacy word for the
  procurement activity, not a form_type.
- **q_a_pair** — the reusable knowledge unit and the Procurement anchor, reusable
  across applications. One client's shared library: never activity-partitioned;
  relevance is computed at query time via `scope_tag` overlap, not a scoping FK.
  Source-form columns are nullable provenance only.
- **reference_item** — an external-source item, continuously ingested (e.g. RSS) and
  primarily consumed by the Intelligence application. Citable, never authoritative on
  its own. Not a form-matching pool: form matching draws on `q_a_pairs` only. No
  publication status; `superseded_by` is the whole of its lifecycle.
- **tenant** — the client's database itself. One Supabase project per client; the
  database is the only tenant boundary; there is no `tenant_id` column anywhere.
  Legacy "cross-workspace" prose means within one client, never across clients.

## Lifecycle and retrieval

- **observe-and-intervene** — the platform-wide write posture: a record exists or it
  doesn't. Versioned edits, post-hoc review, an audit trail — no promotion boundary,
  no publication state machine, no draft flags, for human and agent writes alike.
  Trust is visible (provenance, usage, verification events, freshness), never gated.
- **scope_tag** — the platform's only filter-shaped retrieval axis. Suggested at
  minting, corrected freely in curation, never `NOT NULL`; unscoped records stay
  retrievable and are flagged on the coverage surface, not blocked.
- **subject taxonomy** — display-level derived metadata, never a driver. The driving
  axes are scope (`scope_tag`), semantics (embeddings + keywords + entities; ranking,
  never an exclusion predicate), and concept membership (curated clusters).
- **view / layering** — the consumption-side meaning of "one record, many views": the
  same record rendered differently per audience and surface. A UI/consumption
  principle, not a claim that every fact has one canonical home.

## Containment

tenant (one DB per client) ⊃ applications (application_type) ⊃ activities (form /
proposal / guide, each with its own id) ⊃ their child records; q_a_pairs are
client-level, not activity-partitioned. The workspace tier is retired from this chain.

## Retired vocabulary

Do not reintroduce: **corpus** (name the layer), **promotion / publication gate**
(observe-and-intervene replaced it), **`source_documents` as the ingestion spine**
(replaced by source bindings + the ingest trace), **per-document / residual concepts**
(concept grain is judgment), **`canonical://` URI scheme and row UUIDs in bundles**
(citations use portable external locators; platform surfaces are cited by linking to
their concept files), **anti-tags**, **workspace as a scoping tier**.
