# Workflow surface map

Which dev-lifecycle skills and agents depend on which workflow tooling and data shapes.
This is the starting knowledge for a propagation sweep — it is a living record, not a
freeze. When a sweep finds a dependency not listed here, add it.

Re-authored at the ID-165 ordna cutover: the previous map described the retired
`ledger-cli` + task-view patch-server stack and is superseded wholesale (see "Retired
surface" below).

Roots swept (rediscover, never trust this list blindly):

- canonical `.claude/skills/` (+ each skill's `references/`, `scripts/`)
- canonical `.claude/agents/` — currently absent; quarantined ID-164 agents live in
  `.dev-workflow/sdlc/.claude/`, stale-by-design — **never sweep that tree**
- docs-site `.claude/skills/`, docs-site `CLAUDE.md`, docs-site `tasks/AGENTS.md`

Seed re-grep:

```bash
CANON=~/Documents/development/canonical
DOCS="$KH_PRIVATE_DOCS_DIR"   # sibling knowledge-hub-docs-site checkout
grep -rlnE "ordna|tasks/id-[0-9]+\.md|tasks/AGENTS\.md|status: (backlog|todo|doing|done)" \
  "$CANON/.claude/skills" "$DOCS/.claude/skills" "$DOCS/CLAUDE.md" "$DOCS/tasks/AGENTS.md"
```

---

## Tooling & data-shape glossary (the things that go stale)

**ordna** — the task-ledger substrate since ID-165: one markdown file per task at
`${KH_PRIVATE_DOCS_DIR}/tasks/id-N.md` (YAML frontmatter + body), the Kanban board
*derived* from the files, Git the source of truth. No database, no server, no CLI write
gates. The mechanics + canonical conventions layer live in **docs-site
`tasks/AGENTS.md`** — the single home; do not restate its content here or in skills,
point at it.

Shape essentials that skills reference (all defined in `tasks/AGENTS.md`):

- **Statuses** `backlog → todo → doing → done` (+ hidden `archived`); former status
  qualifiers survive as **tags** (`blocked`, `deferred`, `spec-needed`, `ready`,
  `needs-research`, `parked`).
- **CLI verbs for agents** (non-interactive only — bare `ordna`/`ordna board` hangs):
  `list`/`ls`, `show`, `create`, `move`, `assign`, `commit`. No body-edit or delete verb
  — those are direct file operations. cwd-bound to the docs-site root
  (`cd "$KH_PRIVATE_DOCS_DIR" && ordna …`).
- **Extra-frontmatter keys** (round-trip untouched): `initiative`, `status_note`,
  `priority_note`, `owner`, `effort_estimate`, `capability_theme`, `session_refs`,
  `commit_refs`, `cross_doc_links`, `track`, `type`.
- **Body sections**: `## Goal`, `## Acceptance Criteria` (board-parsed, task-level only),
  `## Notes`, `## Progress` (append-only), `## Subtasks` (`### {N.M} title — status`
  narrative entries; no child task files — DR-089 keeps decomposition in the Intent
  workspace spec-note).
- **Write discipline**: direct in-branch file edits are the norm; the Coordinator alone
  moves a task to `done` (via `ordna move` so the `depends_on` gate fires); promotion is
  a status flip (`ordna move <id> todo`), never a file move.

**Initiatives** — plain docs under
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/`, no longer ledger records;
tasks link to them via the `initiative:` frontmatter key.

**Single id-space** — backlog items are ordinary tasks with `status: backlog`; former
`bl-*` ids were renumbered (`tasks/ID-CROSSWALK.md`).

---

## Dependency table — file → what it references

### canonical `.claude/skills/`

| File                                              | Depends on                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `start-session/SKILL.md`                          | ordna reads (`ordna list`/`show`, `cat` task files) — dedicated ordna-era rewrite pending ({165.20}), expect churn                                                              |
| `handoff/SKILL.md`                                | task-file `## Progress` appends, `ordna commit` — dedicated ordna-era rewrite pending ({165.21}), expect churn                                                                  |
| `recall-grounding/SKILL.md`                       | task-id seeded recall — ordna-era rewrite pending (W5)                                                                                                                         |
| `triage-finding/SKILL.md`                         | decision logic; ordna reads (`ordna list -s doing/-s backlog`, `cat`); routes writes to `tasks/AGENTS.md` §5 (finding hand-off: `ordna create` + provenance frontmatter keys) |
| `triage-finding/references/examples.md`           | initiative-doc coverage reads; `track`/`type`/`priority` backlog-slot vocabulary                                                                                               |
| `research/SKILL.md`                               | task-file reads (`cat`, `ordna list`/`show`)                                                                                                                                   |
| `write-product-spec/SKILL.md`                     | task-id source = ordna task files (`tasks/id-N.md`)                                                                                                                            |
| `write-tech-spec/SKILL.md`                        | task-id source = ordna task files (`tasks/id-N.md`)                                                                                                                            |
| `audit-skill/scripts/detect-drift.sh`             | path-existence detector for repo-root `scripts/…` citations — detector logic, not an invocation; patch only if the pattern shape changes                                        |
| `propagate-workflow-change/SKILL.md` (+ this map) | the sweep procedure itself                                                                                                                                                     |

### canonical `.claude/agents/`

None — directory absent. Quarantined ID-164 agents (task-planner/executor/checker,
workflow-curator, …) live under `.dev-workflow/sdlc/.claude/` and are stale-by-design;
excluded from every sweep.

### docs-site

| File                                                        | Depends on                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tasks/AGENTS.md`                                           | THE conventions home — ordna mechanics adapted to this repo + canonical conventions layer; most changes propagate HERE first |
| `CLAUDE.md`                                                 | describes workflow tooling + cross-repo layout                                                                          |
| `.claude/skills/evaluate-workflow/` + `references/`         | pre-cutover it read task-list.json journals — docs-site flips are {165.16}; re-verify after that lands                  |
| `.claude/skills/evaluate-findings/SKILL.md`                 | pre-cutover it read `product-retros.json` — re-verify after {165.16}                                                    |
| `.claude/skills/sync-ledger-context/SKILL.md`               | ledger→docs drift back-propagation — re-verify after {165.16}                                                           |
| `.claude/skills/check-for-broken-links/SKILL.md`            | pre-cutover it wrote backlog notes via ledger-cli — re-verify after {165.16}                                            |

**Cross-cutting habit:** handoff prompts a `propagate-workflow-change` run before
teardown when a session changed workflow tooling/shapes/process — this skill's own
trigger.

---

## Retired surface (ID-165 cutover — never re-introduce, never sweep)

The entire `ledger-cli` + task-view stack is retired: `scripts/ledger-cli.ts` and the
`ledger-server-*`/`ledger-compact-done`/`regen-mirrors` scripts, `lib/ledger/` (vendored
task-view surface), `lib/validation/{task-list,backlog,initiatives,retro}-schema.ts` +
`ledger-budgets`/`work-status`/`doc-link`, the JSON ledgers (`task-list.json`,
`product-backlog.json`, `initiatives.json`-as-records, `product-retros.json`), per-record
markdown mirrors, `<info added on …>` journals + `append-journal`, field budgets and
record-set delta gates, `rank`, the `.claude/hooks/ledger-compact-session-end.sh` hook,
and the `update-ledgers` skill (archived at
`.dev-workflow/sdlc/.claude/skills/update-ledgers/`).

Replacements: journals → `## Progress` appends; backlog → `status: backlog` tasks in the
single id-space; roadmap/initiatives records → plain initiative docs; budgets/gates →
conventions in `tasks/AGENTS.md`.

Historical references to any of this inside `.dev-workflow/sdlc/` or point-in-time spec
dirs are quarantined/stale-by-design — discard them from every sweep.

## Homograph traps (grep over-matches — discard these)

- `audit-skill/scripts/detect-drift.sh` — repo-root `scripts/…` path talk is a detector
  comment, not a ledger reference.
- "board" in UI/design-skill contexts is not the ordna board.
- "task file" in CI or Playwright contexts is not an ordna task file.
- `tags:` frontmatter in docs-site content collections is Astro, not ordna.
