# Drift taxonomy

The five drift categories, with detection cues, keep/cut rules, and worked examples. The
governing principle throughout: **keep the rule, cut the archaeology.** A skill or agent
file should read as if authored today by someone who has never heard of the sessions that
shaped it.

Before any edit, confirm the **frontmatter boundary** (the detector prints it). Everything
above it — `description:`, `model:`, `effort:`, `color:`, agent `<example>` blocks — is
mandated-verbatim and off-limits. All rules below apply to the **body only**.

---

## A — Provenance archaeology → STRIP

History baked into prose. The reader does not need to know which session produced a rule
to follow it.

Detection cues:

- Session refs (many shapes): `S###`, 2-digit `S60`, suffixed `S62E` / `S62F-WP3`,
  lowercase `s48-feedback`, `post-S280`, "the S262–S264 corpus"
- Subtask / task provenance: `{48.11}`, `{N.M}`, `ID-92`, `ID-N.M ref`
- Open-question tags: `OQ-S###-N`
- Decision tags carrying story: `Q-PLANNER-2`, "per Q-PLANNER-2"
- Dated refs: `2026-06-17`, "as of …", "dated ID-92 ref"
- Narrative archaeology: "previously carried no token data", "used to", "now-moot",
  "legacy framing", "this briefly tried…"

Keep/cut:

- **Cut** the attribution; **keep** the rule it justifies.
- A bare spec anchor (`RESEARCH §7`, `PLAN §13.5`) may stay **only** where it points a
  reader to something they would actually open. If it is decoration, cut it.
- An invariant or section number re-cited as attribution _after_ the concept is introduced
  (`per PRODUCT inv 3`, cited the fifth time) is decoration → cut.

Example:

- ❌ `Per Q-PLANNER-2 (ratified S280), a FRESH Planner instance must write {N.3} TECH.md…`
- ✅ `A fresh Planner instance writes TECH.md — fresh context brings a fresh review pass.`

---

## B — Verbosity / redundancy → STRIP

Words that restate, justify, or pad without adding instruction.

Detection cues:

- "Why these constraints exist" / rationale essays that restate the body
- The same boundary stated 3–4×: an intro "NOT" paragraph + a "What this does NOT do"
  section + a "Scope guard" + a "What you are NOT" list
- Closing "Your success is measured by…" lists that mirror the body
- A long path string (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/…`) repeated many times
- best-practices anti-patterns: explaining the obvious, over-structuring a simple skill,
  offering too many options, inconsistent terminology for one concept

Keep/cut:

- Collapse duplicated boundaries to **one** crisp statement.
- State a long base path **once**, then use a short relative form.
- Keep a _why_ only when it changes behaviour (a non-obvious constraint the reader would
  otherwise violate). Delete _why_ that merely reassures.

Example:

- ❌ Three separate sections each explaining the file-ownership boundary.
- ✅ One "Scope guard" line.

---

## C — Un-extracted reference blocks → EXTRACT (Step 5)

Reference-grade detail inlined in the body instead of living under `references/`. This is
a progressive-disclosure violation: the body should be the workflow; the heavy detail
loads on demand.

Detection cues:

- Inlined rubrics, scoring tables, report templates, metric definitions, protocol
  mechanics
- A body section that is pure reference data rather than instruction
- **No code-intel marker and not asserted by any test** — marked or test-pinned blocks are
  category P (protected, below); they are never extraction candidates

Action:

- Run the preflight: `grep -rl "<distinctive string from the block>" __tests__/`. If a
  test asserts it, STOP — it is category P, leave it inline.
- Otherwise move the block to `references/<topic>.md`; leave a one-line pointer.
- **No duplication** — each fact lives in the body OR a reference, never both.

---

## P — Protected pins → REPORT ONLY (never edit)

Content deliberately pinned inline and guarded by a test. Extracting, moving, or stripping
it breaks CI even though it _looks_ like an un-extracted reference block.

Detection cues:

- `<!-- code-intel:* -->` anchor pairs — in this repo these are code-intelligence anchors,
  guarded by `__tests__/docs/code-intelligence-integration.test.ts` (it asserts the anchor
  pair AND required strings live in the file; some are "duplicated by design").
- Any block whose distinctive strings a file under `__tests__/` asserts (find via the
  preflight grep).

Action:

- Leave it **verbatim** — do not extract, do not remove markers, do not strip the asserted
  strings or even the archaeology inside the block.
- Report it under category P. If it is also duplicated across files (looks like D), it is
  STILL protected — the test pin wins; note it for a coordinated pass that would also
  update the test, but never act on it from a drift audit.

---

## D — Cross-file / cross-repo duplication → REPORT ONLY

The same block living in several sibling files, or a stale copy of something whose
canonical home is elsewhere.

Detection cues:

- A guidance/prose block repeated across sibling files (NOTE: if the block carries a
  `<!-- code-intel:* -->` marker or is test-asserted, it is category P — protected — not
  D)
- A main-repo file that duplicates a docs-site canonical (often subtly stale)

Why report-only: a single-file invocation cannot safely single-source across files.
Deleting the block from this file breaks it unless the shared reference already exists and
is wired up. Flag it — name the duplicate set and the file that holds the most complete
copy — for a coordinated multi-file pass.

---

## E — Stale cross-refs → FIX if unambiguous, else FLAG

References that no longer resolve.

Detection cues:

- A `references/X.md` or `scripts/Y` path that does not exist on disk (orphaned link)
- A `// Source: docs/…` citation to a moved or deleted file
- A command referencing a deleted script (`bun run generate:mcp-inventory`)
- A stale numeric budget ("`≤1500`" where the real limit is 500)

Keep/cut:

- **Fix** when the correct target is unambiguous (the file moved to a findable location;
  the budget's real value is known from the body).
- **Flag** when you cannot determine the correct target without guessing.

---

## Size signals (not hard limits)

Size is a signal to scrutinise harder, never an auto-truncate trigger. Best-practice
bands:

- **Skill body:** aim ≤ ~300 lines; extract to `references/` past that.
- **Agent body:** aim ≤ ~10,000 chars (well-shaped agents land ~3,000–6,000).

A file over band is probably carrying C (un-extracted blocks) or B (verbosity) — look
there first. A file under band with no detector hits is likely already clean; do not
invent work.
