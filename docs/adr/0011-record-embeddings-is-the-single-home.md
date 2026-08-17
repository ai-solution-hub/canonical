# Embeddings live only in record_embeddings; owner_kind is the polymorphic grain discriminator

Crosswalk: DR-036, DR-050

## Context

Several kinds of record become searchable, and each new kind invites a private vector column
beside its own table. Polymorphic search surfaces then need a reliable way to say which kind a
result is, and the nearest existing column is always tempting to reuse for that.

## Decision

Every embedding lives in `public.record_embeddings`, keyed `(owner_kind, owner_id, model)`.
`owner_kind` is the grain discriminator for any polymorphic multi-grain surface; a newly
embedded kind extends the `owner_kind` vocabulary.

## Alternatives considered

- **An inline vector column per table** — rejected: it fragments the search surface, and every
  cross-grain query has to union bespoke shapes.
- **Reusing `content_type` as the grain key** — rejected: it is the closed editorial taxonomy
  on source documents, and overloading it conflates editorial classification with result grain.

## Consequences

- Adding an embedded kind is a vocabulary extension — never a new inline vector column, and
  never a misclassification under an existing kind that happens to be close.
- Result-grain identity on any polymorphic surface reads `owner_kind`.
- `content_type` stays editorial, scoped to source documents, and is never a grain key.
