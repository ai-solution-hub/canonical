/**
 * ledger-sweep-s269.ts — reproducible S269 retroactive over-budget field sweep
 * (ID-34 {34.8}).
 *
 * Trims the `Task.description` (budget <= 1500) and `Task.status_note`
 * (budget <= 300) fields of the over-budget Tasks enumerated in
 * `docs/specs/id-34-task-list-discipline/PRODUCT.md` §4, relocating the excised
 * rationale / session-narrative / acceptance-detail VERBATIM into
 * `docs/research/ledger-field-sweep-s269.md` (relocate-not-delete per inv 13)
 * and adding a `cross_doc_links` pointer back to each swept Task.
 *
 * Write mechanism (mandatory — preserves the shared file for sibling cmux
 * terminals): mutate the `JSON.parse` of the ORIGINAL on-disk text in place
 * (preserves every record's on-disk key order) and serialise via
 * `escapeSerialise` (2-space indent + all non-ASCII `\uXXXX`-escaped + single
 * trailing newline) — byte-identical for every untouched record. See
 * `lib/ledger/scoped-serialise.ts` (ID-35.11) for the proof.
 *
 * HARD EXCLUSIONS: ID-20 and ID-49 records are NOT touched (sibling terminals
 * own them this session). No `status` field is ever changed. Subtask records
 * (incl. 34.8 / 35.11 details) are not touched.
 *
 * Idempotent: re-running detects the already-present cross_doc_links pointer
 * and skips the link-append (the description/status_note assignments are
 * unconditional but byte-stable on re-run).
 *
 * Usage:  bun scripts/ledger-sweep-s269.ts          (apply + validate)
 *         bun scripts/ledger-sweep-s269.ts --check   (validate only, no write)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { escapeSerialise } from '@/lib/ledger/scoped-serialise';
import {
  parseTaskListWithWarnings,
  FIELD_BUDGETS,
} from '@/lib/validation/task-list-schema';

const PATH = 'docs/reference/task-list.json';
const RELO_DOC = 'docs/research/ledger-field-sweep-s269.md';

interface DocLink {
  path: string;
  anchor: string | null;
  raw: string;
}

interface Rewrite {
  id: string;
  /** New compact what+why description (<= 1500). Omit to leave untouched. */
  description?: string;
  /** New acute current-status status_note (<= 300). Omit to leave untouched. */
  statusNote?: string;
  /**
   * When true, append a `cross_doc_links` pointer for the relocated
   * status_note overflow EVEN IF the description was not relocated. Set for
   * the status_note-only swept Tasks (ID-35/47/48/50) whose excised text lives
   * under `## ID-{N} > ### status_note overflow` in the relocation doc. Tasks
   * that also relocated a description already get a (description) pointer, so
   * this flag is omitted for them to avoid a duplicate link.
   */
  statusNoteOnlyLink?: boolean;
}

function reloLink(id: string, kind: 'description' | 'status_note'): DocLink {
  const raw =
    kind === 'description'
      ? 'Relocated over-budget description rationale (ID-34 {34.8} sweep, S269)'
      : 'Relocated over-budget status_note (ID-34 {34.8} sweep, S269)';
  return { path: RELO_DOC, anchor: `id-${id}`, raw };
}

// ── Per-Task rewrites ───────────────────────────────────────────────────────
// Each description is a compact what+why (no acceptance lists, no journal, no
// rationale prose — those live in the relocation doc). Each status_note keeps
// only the acute current-status assertion. Verbatim excised content is in
// docs/research/ledger-field-sweep-s269.md under `## ID-{N}`.

const REWRITES: Rewrite[] = [
  // ── REQUIRED: description > 2500 (10) ───────────────────────────────────────
  {
    id: '19',
    description:
      'Harden sub-agent worktree isolation so commits cannot leak to the parent track branch. Deterministic cause (per worktree-isolation synthesis): a sub-agent leaks only if it issues a bash `cd`/`git -C` into the absolute knowledge-hub path or passes that path to Edit/Write; relative-path agents mechanically cannot leak. Delivers four defence tiers (brief/skill discipline, PreToolUse hooks, Checker dual-log gate, sandbox permission allowlist) plus the S59 propagation discipline ensuring hooks reach sub-agent worktrees. Acceptance criteria + per-tier detail relocated to docs/research/ledger-field-sweep-s269.md#id-19.',
  },
  {
    id: '23',
    description:
      'Integrate the three code-intelligence tools (GitNexus, ast-dataflow, ccc / cocoindex-code) into the Planner / Executor / Checker / Curator dispatch surfaces of workflow-orchestration so sub-agents actually invoke them. Today the 36,955-symbol GitNexus index, 12-query ast-dataflow CLI, and ccc semantic search are dead infrastructure for sub-agents — 63/63 tool-integration cells across 9 patterns x 7 surfaces measured MISSING in the S61 WP5 audit. All skill edits go via update-skill / agent-development (no manual SKILL.md edits); one skill invocation per Executor Subtask. Acceptance criteria + constraints relocated to docs/research/ledger-field-sweep-s269.md#id-23.',
  },
  {
    id: '27',
    description:
      'Close the 4 cmux-script gaps surfaced in S61 carryover #2 so cmux can fully replace Agent-tool isolation:worktree as the canonical parallel-dispatch primitive (S62 W1 re-test confirmed Anthropic worktree-isolation is structural, not session-cache; cmux explicit `git worktree add` from PROJECT_ROOT bypasses it). Shipped in one commit (25a5fa1b): launch-worker --brief flag, .worktreeinclude honour, stop-worker --delete-branch opt-in, wait-for-fleet bash-3.2 portability. Not blocking ID-9/ID-20; independent maintenance. Motivation, what-shipped detail, OQs, and acceptance criteria relocated to docs/research/ledger-field-sweep-s269.md#id-27.',
  },
  {
    id: '28',
    description:
      'Stand up the cocoindex 1.0.3 pipeline scaffolding for the canonical document -> embeddings flow plus the Cloud Run sidecar hosting the heavy extractor binaries (Docling 1.8 GB + pullmd 3.7 GB Playwright). T8 is the foundational pipeline implementation step in canonical-pipeline-implementation-plan/PLAN.md §4.8; downstream T7 (client Q&A first-ingest) depends on it. Multi-session arc: S252 authored the {28.1}-{28.4} spec chain; implementation Subtasks {28.5+} dispatched S253+. Full acceptance criteria, dependencies, and the close-ceremony journal blocks relocated to docs/research/ledger-field-sweep-s269.md#id-28.',
    statusNote:
      'Closed S265 (sub-orchestrator subo-id28). Core write path landed: re-grounded specs (28.20) + reactive declare_row write path (28.21) + env-scope @coco.lifespan DB pool (28.22), all Checker-gated. Unblocks ID-42 ingest proof. Remaining pipeline stages deferred to ID-49 (see #id-28 overflow).',
  },
  {
    id: '29',
    description:
      'Migrate `lib/workspace-types.ts` static WORKSPACE_TYPE_REGISTRY to TanStack Query against the `application_types` table, using the Option C hybrid metadata pattern ratified S251 (admin-editable copy in DB columns; dev-editable routing/features in a static client map). Promoted retroactively from backlog ID-21 during main-track-S252 with a partial spec chain (TECH ratified S251 commit 8581bf4f; PRODUCT skipped as a no-behaviour refactor). APPLICATION_TYPE_KEYS tuple preserved for the sync Zod enum. Acceptance criteria + retroactive-promotion rationale + code-simplification journal relocated to docs/research/ledger-field-sweep-s269.md#id-29.',
    statusNote:
      'Promoted retroactively from backlog ID-21 (main-track-S252). 29.1/29.2/29.3 retrofitted to as-is state; 29.4 PLAN.md authored S252 WP5, decomposed into linear-dep impl Subtasks 29.5..29.8. Awaiting Liam ratification gate before Orchestrator dispatches 29.5. Full narrative: #id-29 overflow.',
  },
  {
    id: '30',
    description:
      'Consolidate product-roadmap.json content into product-backlog.json (single canonical work list), then rethink the roadmap as a thin capability-themes surface per Linear / Aha! best practice. Motivation (s48-feedback line 201): the roadmap is misused as a prioritised parking lot while the backlog is treated as deferred-only — the inverted semantic vs standard product-management convention. Six-step approach per S62 W2 Liam ratification (audit dedup, collapse redundant items, migrate to backlog, reshape roadmap to ~10-12 themes, dedup vs task-list + rank field, extend task-view CRUD). Full approach, acceptance criteria, and close narrative relocated to docs/research/ledger-field-sweep-s269.md#id-30.',
  },
  {
    id: '31',
    description:
      'Migrate the canonical-pipeline implementation plan (canonical-pipeline-implementation-plan/PLAN.md, T1-T14) into task-list.json as top-level Tasks, keeping PLAN.md as spec substrate (Option 2 per S62 W2 Liam ratification). Includes retrospective `done` Task population for T1-T6 + pre-phase work and a Linear-Initiative-analogue umbrella/tag model (Option C: separate umbrellas.json with curated task_ids[] + substrate_doc). Motivation (s48-feedback line 200): the rich PLAN.md substrate lives outside the task-list, breaking single-surface traceability. Full approach, acceptance criteria, and Wave-1 close narrative relocated to docs/research/ledger-field-sweep-s269.md#id-31.',
  },
  {
    id: '33',
    description:
      'Address the three quality-of-life polish fixes surfaced by S62B orchestrator-of-orchestrators e2e verification (none are correctness blockers; none gate Path A migration): FX-1 stop-worker.sh resilience polish, FX-2 Tier 2.2 `git -C` hook read-only subcommand whitelist, FX-3 launch-worker.sh collision-diagnostic specificity. Evidence + full per-fix change scope in docs/research/orchestrator-of-orchestrators-e2e-findings.md §3. Acceptance criteria + the S62C close journal + the ID-28 -> ID-33 cross-branch rename journal relocated to docs/research/ledger-field-sweep-s269.md#id-33.',
  },
  {
    id: '42',
    description:
      'Deploy a shared pullmd Cloud Run Service (Node.js Express + Trafilatura + Playwright ~3.7 GB; AGPL v3) across kh-staging-494815 and kh-prod-494815 per the O-Q3 ratification that pullmd remain a separately-deployed network service (AGPL boundary, 03-tech-stack.md §7), wire the real PULLMD_SERVICE_URL secret to replace the S258 placeholder (cabled at cloud-run-deploy.yml:L345 assuming the Service existed), and retire the HTML extraction code paths superseded by pullmd Tier 2/2.5/3 (Firecrawl / Jina / direct-fetch cascade) with no dead-code leftover. Full surface inventory is the first action of {42.1} RESEARCH. Acceptance criteria + status_note overflow relocated to docs/research/ledger-field-sweep-s269.md#id-42.',
    statusNote:
      'Spec-needed: {42.1} RESEARCH (HTML-extraction surface inventory + pullmd deployment topology) -> {42.2} PRODUCT -> {42.3} TECH -> {42.4} PLAN. Discovered S258 Wave 0 pre-flight as a T8 scope-gap (Inv-9 + Inv-7 dependency on a deployed pullmd never tracked). Full provenance: #id-42 overflow.',
  },
  {
    id: '44',
    description:
      'Five ready, code/spec-bounded follow-ups deferred out of the ID-28 (T8) canonical-pipeline arc: live _emit_upsert_log wiring (28.10 deferral), TECH §P-8 fictional-retry-API spec drift, ANTHROPIC_MODEL constant duplication, TestHealthEndpoint real-socket false-negatives, and cocoindex pytest cross-file stub pollution. Promoted from backlog 159/161/167/168/175 (kh-main-S261) — these are incomplete-T8 residuals, not parked product features. The close journal (3/5 delivered + Checker-gated; 44.1+44.2+Inv-11 re-homed into the reopened ID-28.20) is relocated to docs/research/ledger-field-sweep-s269.md#id-44.',
    statusNote:
      'CLOSED S262 (cmux sub-orchestrator). 44.3/44.4/44.5 delivered + Checker-gated; 44.1+44.2+Inv-11 folded into ID-28.20. End-of-task code-simplification + quality-review waived (Liam-approved) as disproportionate for 3 mechanical residual fixes. All work on cmux-worker-subo-id44-2fbe3960.',
  },

  // ── REQUIRED: status_note > 300 only (description in budget) ─────────────────
  {
    id: '32',
    description:
      'Implement `scripts/codemods/wrap-define-route.ts`, a ts-morph utility that wraps the 137 mechanisable + 40 NEEDS-REVIEW routes from the route-shape inventory. The codemod offers dry-run + apply modes, infers ResponseSchema via the type-drift baseline (Source A per TECH.md), and integrates with lib/ast-dataflow/queries/type-drift-detect.ts as a post-migration verifier; scope also covers a test fixture set per Phase-1 shape variants. Specs authored S11 R-WP-S11-A. Acceptance detail + the S62C OQ ratifications journal relocated to docs/research/ledger-field-sweep-s269.md#id-32.',
    statusNote:
      'ALL 28 subtasks done (S265, ast track). OPS-T1 Option-4 codemod PROVEN + gated on a TEMP COPY (AC-1..10 green); working tree GREEN with NO routes wrapped. Per Liam OQ-10 the working-tree corpus rollout is the separately-resourced Task ID-50. Full detail: #id-32.',
  },
  {
    id: '35',
    statusNoteOnlyLink: true,
    statusNote:
      'S266: PRIORITISED for the next-session parallel-cmux phase (Liam) — spec-review the 35.1-35.4 chain against task-view’s shipped patch primitives, then build as one cmux terminal, replacing the hand-written python ledger-splice with `bun scripts/ledger-cli.ts`. Dep ID-20 now DONE; ID-34 still gating.',
  },
  {
    id: '47',
    statusNoteOnlyLink: true,
    statusNote:
      'All 7 subtasks done (S265, ast track). DB-layer warp analog complete: structural JSONB override + supabase-types-parity CI staging gate + CLAUDE.md TypeScript conventions + 11 consumers migrated + SCHEMA-QUICK-REFERENCE retired. Opaque-Json + caller-less RPC deletes deferred (OQ-6/7).',
  },
  {
    id: '48',
    statusNoteOnlyLink: true,
    statusNote:
      'Opened S264 (main-track O-of-O) per Liam — workflow-evaluation programme. Seeded from docs/specs/workflow-evaluation/feedback-dossier-S264.md (ID-32 blind-spec lessons + Liam’s 9 notes). Paired with ID-23; next-session terminal runs {48.1} RESEARCH.',
  },
  {
    id: '50',
    statusNoteOnlyLink: true,
    statusNote:
      'S267 (ops-rollout cmux sub-o): {50.1} ASSESS + {50.2} PLAN DONE -> ASSESS-S267.md + PLAN.md §4b + {50.3}-{50.11} records spliced. NO routes wrapped (HARD SCOPE = 50.1+50.2). Regenerated scope: 177 wrapped (132 TRANSFORM + 45 NEEDS_REVIEW), 18 MANUAL excluded. Impl waves {50.3+} are a FUTURE session.',
  },

  // ── STRETCH: description 1500-2500 (budget permitting) ───────────────────────
  {
    id: '9',
    description:
      'COMPOUND TASK, four concerns in one delivery: (1) IMPLEMENT the Astro+Starlight docs site per the existing DRAFT spec at docs/specs/id-9-astro-starlight-docs-foundation/ (PRODUCT.md + TECH.md authored S47, not yet ratified) — base site, content collections, branded build, deploy pipeline; (2) PORT Warp’s docubot auto-sync approach + integrate six Warp docs skills into .claude/skills/ (extract ontology/schema/reference docs from code, regenerate on push); (3) DECOMMISSION the bespoke .claude/skills/update-docs/ skill once the platform is live; (4) UNLOCK main-track Ontology auto-sync via the same docubot mechanism. The {N.1}-{N.4} spec-authoring chain covers the unspecced docubot+skills extension. Acceptance criteria + dependencies relocated to docs/research/ledger-field-sweep-s269.md#id-9.',
  },
  {
    id: '15',
    description:
      'Migrate all legacy-format item IDs across the three task surfaces (roadmap, backlog, task-list) to the canonical ID-N / ID-N.M format per s48-feedback.md B2. Legacy formats in scope include OPS-*, AST-S{N}-O{M}, C{N}-T{M}-* / C{N}-DT-* / C{N}-PA{N}, R-WP-S{N}-{X}, RLS-P{N}, and others surfaced during inventory. A deterministic, idempotent, dry-run-able migration script produces a Liam-ratified legacy->ID-N mapping and applies it atomically across all three JSON files plus their cross-doc references, then is deleted post-merge per the migrate-roadmap-section-3.ts precedent. Acceptance criteria + dependencies relocated to docs/research/ledger-field-sweep-s269.md#id-15.',
  },
  {
    id: '16',
    description:
      'Review the ast-dataflow track handover at session start and close out its worktree. The ast-dataflow track merged its in-flight work to production-readiness during S51 (merge commit 03392948); a 154-line HANDOVER.md (commit 16b6a5bb) documents the cross-track merge mechanics, the nine-session arc, the OPS-T1 codemod specs, six AST-prefixed backlog items, three S11 gotchas, and read-first order. This Task validates the 6 follow-on backlog items are captured + sequenced, cross-checks the three gotchas against CLAUDE.md, and tears down the ast-dataflow worktree once Liam confirms no uncommitted work. Acceptance criteria + dependencies relocated to docs/research/ledger-field-sweep-s269.md#id-16.',
  },
  {
    id: '22',
    description:
      'Move the three canonical workflow ledgers (task-list.json, product-roadmap.json, product-backlog.json) out of docs/reference/ into .planning/task-management/. Rationale (S57 ratification): workflow ledgers are session/SDLC state, not product reference documentation, and the current colocation conflates two concerns; the period-prefix has zero indexing impact (mirrors Taskmaster’s .taskmaster/ convention). Scope: git-mv the files, rewrite ~33 cross-references, repoint parseTaskListWithWarnings + the ID-20 mirror tool + CLAUDE.md tables. Depends on ID-15 (avoid compounding two migrations on the same data file). Acceptance criteria + sequencing rationale relocated to docs/research/ledger-field-sweep-s269.md#id-22.',
  },
  {
    id: '24',
    description:
      'RE-SCOPED kh-S260: the worktree collapse executed off-spec at S71 close via fast-forward alias (origin/main = origin/production-readiness = origin/content-items-investigation) rather than the planned per-worktree merge waves, which already folded all in-flight work (incl ID-9/ID-20) into main. This Task is reduced from a 4-subtask spec-chain to a thin ratification + cleanup list (24.1-24.7); the dependency gate [9,20] is spent. Goal: collapse the long-lived worktrees back to main, retire docs/tracks/*.md, and rewrite the CLAUDE.md/SOTP single-track narrative. Historical original plan, acceptance criteria, and dependencies relocated to docs/research/ledger-field-sweep-s269.md#id-24.',
  },
  {
    id: '25',
    description:
      'CANCELLED (S62 W2) — superseded by ID-30 (consolidation + roadmap rethink) + ID-31 (canonical-pipeline migration approach). Originally proposed restructuring product-roadmap.json §3 so each phase becomes its own top-level Task, for a uniform TM Task/Subtask shape across all three ledgers. Per Liam ratification at S62 W2 the phase-restructure was premised on the inverted roadmap/backlog semantic and is no longer the right shape; user intent is the Linear-style consolidation + thin capability-themes roadmap (Shape A) delivered by ID-30/ID-31. Original goal, acceptance criteria, and full cancellation note relocated to docs/research/ledger-field-sweep-s269.md#id-25.',
  },
  {
    id: '43',
    description:
      'Implement the durable Open-Question (OQ) escalation/decision channel specified in docs/specs/id-43-oq-escalation/PRODUCT.md (33 invariants): a cmux sub-worker emits a self-contained immutable OQ record (oq_id, worker_id, urgency, blocking flag, context_ref) to its parent orchestrator and receives an addressed decision back. Covers blocking vs non-blocking semantics, per-worker FIFO ordering, atomic durable append-only idempotent emission, cancellation, at-least-once decision delivery with a 10s latency bound, an awaiting-decision worker state, and crash/restart safety. PRODUCT shipped S62 (a47066c4) but was orphaned (no TECH, untracked) until re-instated S260. Provenance + acceptance criteria + dependencies relocated to docs/research/ledger-field-sweep-s269.md#id-43.',
  },
  // ── OQ-LS-3 (S270): ID-49 released from EXCLUDED + swept ─────────────────────
  {
    id: '49',
    description:
      'Follow-on to ID-28. ID-28 landed the critical-path CORE on the installed cocoindex 1.0.3 REACTIVE App/mount_each/declare_row API: the functional Stage-6 declare_row write path (ID-28.21), env-scope @coco.lifespan DB pool (ID-28.22), and the re-grounded specs (ID-28.20) — this unblocked the ID-42 ingest proof. THIS Task completes the remaining canonical-pipeline stages that were decomposed but deferred: App boot wiring (sidecar can launch the App), Stage-4 embedding (vector search), _emit_upsert_log live wiring, layered-retry alignment, Stage-5 entity resolution (+faiss pin), the real-Supabase integration tests, and per-file importlib.reload test isolation. Full grounding + subtask provenance relocated to docs/research/ledger-field-sweep-s269.md#id-49.',
    statusNote:
      'Created S265 (sub-orchestrator subo-id28) per Liam land-core/defer decision (ast-pattern). ID-28 core write path landed+gated; remaining pipeline stages tracked here for a DEDICATED future orchestrator. CAVEAT detail relocated to docs/research/ledger-field-sweep-s269.md#id-49.',
  },
];

const EXCLUDED = new Set(['20']);

function main() {
  const checkOnly = process.argv.includes('--check');
  const originalText = readFileSync(PATH, 'utf8');
  const doc = JSON.parse(originalText) as {
    tasks: Array<Record<string, unknown>>;
  };

  const byId = new Map(doc.tasks.map((t) => [t.id as string, t]));
  const touched: string[] = [];

  for (const rw of REWRITES) {
    if (EXCLUDED.has(rw.id)) {
      throw new Error(`Refusing to touch excluded Task ID-${rw.id}.`);
    }
    const task = byId.get(rw.id);
    if (!task) throw new Error(`Task ID-${rw.id} not found.`);

    // Never alter status. (Guard: read-only assertion — we never write it.)
    let changed = false;

    if (rw.description !== undefined) {
      if (rw.description.length > FIELD_BUDGETS.taskDescription) {
        throw new Error(
          `ID-${rw.id} new description is ${rw.description.length} chars (> ${FIELD_BUDGETS.taskDescription}).`,
        );
      }
      task.description = rw.description;
      changed = true;
    }
    if (rw.statusNote !== undefined) {
      if (rw.statusNote.length > FIELD_BUDGETS.taskStatusNote) {
        throw new Error(
          `ID-${rw.id} new status_note is ${rw.statusNote.length} chars (> ${FIELD_BUDGETS.taskStatusNote}).`,
        );
      }
      task.status_note = rw.statusNote;
      changed = true;
    }

    // Append the relocation pointer once (idempotent). The dedup key is
    // path + anchor + raw, so a description pointer and a status_note pointer
    // to the same `## ID-{N}` section coexist without either being suppressed.
    function ensureLink(link: DocLink): void {
      const links = (task!.cross_doc_links ??= []) as DocLink[];
      const exists = links.some(
        (l) =>
          l.path === link.path &&
          l.anchor === link.anchor &&
          l.raw === link.raw,
      );
      if (!exists) links.push(link);
    }

    // Description relocations get a (description) pointer.
    if (rw.description !== undefined) {
      ensureLink(reloLink(rw.id, 'description'));
    }
    // Status_note-only relocations (ID-35/47/48/50) get a (status_note)
    // pointer to their `### status_note overflow` subsection. Tasks that also
    // relocated a description are already reachable via the description
    // pointer, so they do NOT set statusNoteOnlyLink (avoids a duplicate).
    if (rw.statusNoteOnlyLink) {
      ensureLink(reloLink(rw.id, 'status_note'));
    }

    if (changed) touched.push(rw.id);
  }

  // Validate the mutated document (hard-parse must not throw).
  const { warnings } = parseTaskListWithWarnings(doc);

  // No Task-level description/status_note warning may remain for any swept
  // Task. Subtask-level description/testStrategy warnings (~200 across the
  // ledger) are explicitly DEFERRED per PRODUCT §4 ("low priority; cosmetic")
  // and are NOT in this sweep's scope, so the filter matches Task-level
  // messages only (`Task "N" description is …` / `Task "N" status_note is …`,
  // never `Subtask N.M …`).
  const sweptIds = new Set(REWRITES.map((r) => r.id));
  const offenders = warnings.filter(
    (w) =>
      sweptIds.has(w.taskId) &&
      (/^Task "\d+" description is /.test(w.message) ||
        /^Task "\d+" status_note is /.test(w.message)),
  );
  if (offenders.length) {
    throw new Error(
      `Post-sweep field warnings remain for swept Tasks:\n` +
        offenders.map((o) => `  - ${o.message}`).join('\n'),
    );
  }

  if (checkOnly) {
    console.log(
      `--check OK. Would sweep ${touched.length} Tasks: ${touched.join(', ')}. ` +
        `Residual warnings (non-fatal): ${warnings.length}.`,
    );
    return;
  }

  writeFileSync(PATH, escapeSerialise(doc));
  console.log(
    `Swept ${touched.length} Tasks: ${touched.join(', ')}.\n` +
      `Residual warnings (non-fatal, e.g. excluded ID-49 or Subtask-level): ${warnings.length}.`,
  );
}

main();
