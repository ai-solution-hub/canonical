# Decisions live as in-repo ADRs with a DR crosswalk; CONTEXT.md is the vocabulary baseline

Crosswalk: DR-155

## Context

Platform decisions previously lived in a register in a separate private repository, and the
domain vocabulary lived in a glossary there that predated the ratified PRD. Every agent read
of a decision or a term paid a cross-repo hop, and the engineering skills this repo installs
consume a repo-local `docs/adr/` plus a root `CONTEXT.md`.

## Decision

Decisions live in this repo as ADRs under `docs/adr/`, numbered from 0001, each carrying a
one-line `Crosswalk: DR-NNN` reference to the source ruling. A root `CONTEXT.md` is the
vocabulary baseline, validated entry-by-entry against the PRD and maintained thereafter by
`/domain-modeling`.

## Alternatives considered

- **Point the engineering skills at the external register** — rejected: keeps the cross-repo
  hop on every read and leaves a vocabulary baseline that predates the ratified PRD.
- **Migrate the legacy decision files wholesale into this repo** — rejected: they carry
  point-in-time client-specific material into a public repo, and moving them breaks the
  register's never-delete / never-renumber invariants.

## Consequences

- ADR admission is platform operational or architectural **by definition**. Model-level
  content — product strategy, commercial framing, client-specific rulings — is a PRD
  amendment and never an ADR.
- The legacy register is closed. It remains in the private repository as history, is not
  extended, and is not the place a new decision lands.
- Rulings re-authored here are written fresh from the source decision rather than copied, so
  nothing client-specific crosses into the public repo by accident.
- The session-close protocol writes new decisions to `docs/adr/`.
