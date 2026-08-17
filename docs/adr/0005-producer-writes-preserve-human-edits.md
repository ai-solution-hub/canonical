# Producer writes preserve human edits: concept frontmatter round-trips byte-faithfully

Crosswalk: DR-144

## Context

The concept bundle is co-authored: the producer emits documents, and humans and agents edit
them in place afterwards. A producer run that re-emits frontmatter from scratch can normalise
flow mappings into block form, requote scalars, or silently truncate shapes nobody enumerated —
destroying edits the run did not make and cannot see.

## Decision

Concept frontmatter round-trips byte-faithfully across a capture → reapply cycle, and the
parser re-renders what it parsed and refuses loudly when the rendering does not match its own
source lines. A producer run never destroys an edit it did not make.

## Alternatives considered

- **A hand-rolled emitter and parser** — rejected: the maintenance surface is the recurring
  source of the defect class (escaping that covers quotes and backslashes but not newlines,
  emitting a broken multi-line scalar), and correctness is re-argued every time the shape grows.
- **A normalising YAML serialiser (`safe_load`/`safe_dump`)** — never a candidate, on
  structure rather than preference: it reformats flow mappings and requotes scalars, so it
  cannot satisfy the byte-faithful requirement by construction. Only a round-trip-preserving
  library can.

## Consequences

- Round-trip fidelity must be demonstrated by test, not inherited from a library's reputation.
  Round-trip mode preserves what it *parsed*; the emitter writes fresh, so preservation is not
  automatic on the write path.
- Loud refusal is shape-general and is itself a guarantee: it holds for shapes nobody
  enumerated, and degrading it back to silent truncation is the defect this ruling prevents.
- Scope is the producer's frontmatter path. The TypeScript OKF consumer is untouched by this
  ruling; whether it should take a YAML library is a separate question.
