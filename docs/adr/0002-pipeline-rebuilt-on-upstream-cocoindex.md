# The ingestion pipeline is rebuilt on upstream cocoindex primitives at root-level pipeline/

Crosswalk: DR-152, DR-142

## Context

The previous ingestion tree had grown to roughly the size of the upstream library it is built
on while calling 12 of that library's 88 top-level exports, with five measured duplications of
installed upstream capability (pair resolution, declared row targets, retry stacks, ID
generation, the connector/source API). A second machinery layer — mock LLM server, bespoke memo
identity, writer fences, fault injection — existed only because every walk to date had been
synthetic-corpus and mock-tier. Against a two-person operability constraint, repairing that
tree is the expensive option.

## Decision

The pipeline is built on upstream cocoindex primitives at the root-level `pipeline/`, which
holds the runtime bundle and its Python tests. It is two small flows — ingestion (sources →
provenance register + staged records) and producer (promoted records → OKF bundle) — using
upstream connectors, targets, ops (entity resolution, LiteLLM, splitting) and identity
primitives directly.

## Alternatives considered

- **Repair the existing tree in place** — rejected: it polishes the machinery the evidence
  identifies as the problem.
- **Proof spike first, then decide** — declined; the spike's content (real data, upstream
  style, end to end) folds into the rebuild's first phase instead of running as a gate.
- **Adopt an external producer wholesale** — deferred to its own evaluation: it replaces
  neither the ingestion flow nor the admission gate.
- **A `services/` tier for the pipeline** — declined: no requirement source names one, and it
  splits the deployed image's source across two roots.
- **Nesting `deploy/` under the pipeline root** — declined: it demotes `deploy/` from the root
  level and reintroduces the mixed-language junk-drawer property the layout exists to remove.
- **Leaving the Python tests outside the pipeline tree** — declined: tests are filed by the
  domain that owns them, and the split would mean two pytest invocations for a few files.

## Consequences

- Ratified product contracts port as **acceptance tests**, never as ported machinery: the
  two-gate admission model and retention classes, entity-naming stability, per-retention-class
  survival, mention anchoring, unpublished-never-cited, and the frozen citation-identity seed
  contract — the uuid5 namespace and seed formulas were frozen at first bundle publication, so
  the rebuilt producer must mint the same ids or every published citation orphans.
- The mock LLM tier does not return. Provider selection is LiteLLM configuration chosen per
  stage; testing is recorded fixtures plus small real-tier smokes.
- Python tests live in `pipeline/` beside the code they cover; `deploy/` stays a root-level
  sibling.
- CI's Python paths filter must track the pipeline root. If it stops matching, the pytest step
  never fires and every PR passes green with zero Python tests run.
