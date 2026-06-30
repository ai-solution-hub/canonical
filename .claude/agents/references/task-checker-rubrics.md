# Task Checker — audit rubrics (load on demand)

Reference detail for the `task-checker` agent body. Loads on demand; the body holds the
workflow and the always-on axes.

## Staff-engineer review lens

A framing aid for reading the diff like a senior reviewer answering one question — "would a
staff engineer approve this for merge?" Each dimension maps onto a Canonical audit axis you
already score; record every finding under the Canonical axis named here, never under a
dimension name (the lens adds no new JSON `axis` value).

| Lens dimension   | Records under Canonical axis                                                                       | What the lens adds                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Correctness**  | `spec-compliance` (does it do what `testStrategy` says) + `test-quality` (tests prove it)          | The explicit edge-case / error-path / race-condition prompt.                                          |
| **Readability**  | `code-quality` (UK English, naming, control flow, error handling)                                  | "Can another engineer understand this without explanation?" as a self-check.                          |
| **Architecture** | `code-quality` + `type-design` (quality-review) + `silent-failure` (module boundaries, no barrels) | The "is this new pattern justified?" question; `silent-failure` already enforces no-barrel-reexport.  |
| **Security**     | `security` (quality-review only) — auth surface, public-route allowlist, SECURITY DEFINER, Zod     | In `standard`, flag obvious security smells as out-of-scope notes.                                     |
| **Performance**  | `performance` (quality-review only) — N+1, unbounded fetch, missing pagination, re-renders         | The staff-engineer prompt to look; no new scoring.                                                    |

If the read surfaces, say, an N+1 query, record it once under `performance` — never
additionally as a "correctness" or "architecture" finding.
