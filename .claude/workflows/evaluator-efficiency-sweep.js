// Knowledge Hub — saved /workflows dynamic workflow
// PILOT (ID-48.21): the workflow-evaluator EFFICIENCY SWEEP (the `evaluate-workflow`
// lane, {48.5}) authored as a STATELESS, READ-ONLY fan-out so the corpus sweep is
// OFFLOADED from the main-session (O-of-O) context instead of running inline.
//
// WHY /workflows here (and ONLY here): the efficiency sweep is read-only + stateless
// (no worktree lifecycle, no commits, no ledger writes). Intermediate per-session metric
// slices stay in this script's variables, NOT in the orchestrator's context window — that
// context-offload is the whole point of the pilot. Stateful Subtask lifecycle work
// (worktrees, cherry-pick, ledger writes, mid-session OQ-escalation, durable attachable
// terminals) STAYS on cmux (`session-driver-cmux`). See the cmux-vs-/workflows decision
// boundary documented in
// `.claude/skills/workflow-orchestration/references/dispatch-primitives.md`.
//
// EXPLICIT CONSTRAINTS (Liam):
//   - ultracode OFF, auto-workflow OFF — this is a MANUAL saved command (`/evaluator-efficiency-sweep`),
//     never autonomous. ultracode/auto conflict with KH's deliberate spec-gated cadence.
//   - READ-ONLY — no worktree lifecycle, no commits, no ledger writes. The spawned AGENTS
//     read the archived corpus via their own tools; this script itself has NO fs/shell access.
//   - PILOT scope — ONE workflow only. This does NOT migrate the SDLC lifecycle to /workflows.
//
// CORPUS shape (read by the spawned agents, per `evaluate-workflow` SKILL.md + RESEARCH §7):
//   docs/workflow-evaluation/sessions/S<NNN>/<worker>/{events.jsonl, oq-pending.md,
//   final_report.yaml, meta.json}  (archived BY DEFAULT at teardown per {48.17}).
//   - final_report.yaml carries `token_usage_by_role` (per-role {input, output,
//     cache_creation, cache_read, total, turn_count}; primary unit = sub_orchestrator)
//     + `token_usage_total`, written at archive time from the worker transcript's
//     `message.usage` by lib/workflow-evaluation/token-rollup.ts ({48.17}).
//   - events.jsonl carries Read/Bash/dispatch/git tool events for duplicated-read,
//     redundant-dispatch (E1/E6), megaturn and coordination-overhead (E3/E4) signals.

export const meta = {
  name: 'evaluator-efficiency-sweep',
  description:
    'Stateless read-only fan-out of the workflow-evaluator efficiency sweep (evaluate-workflow lane) over an archived session corpus. Computes the RESEARCH §7 metric set (token usage per role, duplicated reads, redundant dispatches E1/E6, megaturns, E3/E4 coordination overhead) and assembles a §7 report. PILOT (ID-48.21): manual command only; ultracode/auto OFF; read-only — no worktree lifecycle, no commits, no ledger writes. cmux remains the surface for stateful SDLC lifecycle work.',
  phases: ['discover', 'fan-out', 'synthesise'],
};

// --- per-session metric-slice schema (each fan-out agent returns one of these) ---
// Mirrors the RESEARCH §7 metric set so the synthesis agent can assemble the report
// without re-reading the corpus. Token figures come from final_report.yaml
// token_usage_by_role / token_usage_total; the rest from events.jsonl.
const metricSliceSchema = {
  type: 'object',
  required: [
    'session',
    'tokenByRole',
    'duplicatedReads',
    'redundantDispatches',
    'megaturns',
    'coordinationOverhead',
  ],
  properties: {
    session: { type: 'string', description: 'Session id, e.g. "S273".' },
    workers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Worker subdir names read for this session.',
    },
    tokenByRole: {
      type: 'object',
      description:
        'Per-role token totals from final_report.yaml token_usage_by_role. Null/absent role => token usage unavailable for that worker (do NOT fabricate); record a note instead.',
    },
    tokenTotal: {
      type: ['number', 'null'],
      description: 'token_usage_total for the session (null if unavailable).',
    },
    duplicatedReads: {
      type: 'array',
      description:
        'Top offenders: same file_path read by N distinct workers (or same worker N times). Each: {filePath, readCount, workers}.',
      items: {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          readCount: { type: 'number' },
          workers: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    redundantDispatches: {
      type: 'object',
      description:
        'Observed counts per class (E1 = silent agent-creator sub-dispatch; E6 = curator triaged-but-not-executed).',
      properties: {
        E1: { type: 'number' },
        E6: { type: 'number' },
      },
    },
    megaturns: {
      type: 'object',
      description:
        'Turns exceeding the token/tool-call threshold (compaction-risk surface).',
      properties: {
        count: { type: 'number' },
        top3: {
          type: 'array',
          description: 'Top-3 turns by token count, each {turnRef, tokens}.',
          items: {
            type: 'object',
            properties: {
              turnRef: { type: 'string' },
              tokens: { type: 'number' },
            },
          },
        },
      },
    },
    coordinationOverhead: {
      type: 'object',
      description:
        'E4 = N-way task-list.json reconciliation; E3 = stale-worktree fetch+reset tax.',
      properties: {
        E3: { type: 'number' },
        E4: { type: 'number' },
      },
    },
    escalations: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Per-session corpus problems (missing/empty events.jsonl, purged token transcript, malformed artefacts).',
    },
  },
};

export default async function evaluatorEfficiencySweep() {
  // `args` is the corpus root. Default to the canonical archive location.
  const corpusRoot =
    (typeof args === 'string' && args.trim()) ||
    'docs/workflow-evaluation/sessions/';

  log(`Evaluator efficiency sweep (read-only) over corpus root: ${corpusRoot}`);

  // --- Phase 1: discover the session range -------------------------------------------
  // The script has NO fs access, so a discovery agent enumerates the archived sessions.
  phase('discover');
  const discovery = await agent(
    [
      'You are a read-only corpus scout for the Knowledge Hub workflow-evaluator efficiency sweep.',
      `List every archived session directory under "${corpusRoot}" (each is named S<NNN>, e.g. S273).`,
      'For each session, list its worker subdirectories. Read NOTHING beyond directory listings.',
      'Return a JSON object: { "sessions": [{ "session": "S273", "path": "...", "workers": ["sub-orchestrator", ...] }] }.',
      'If the corpus root does not exist or is empty, return { "sessions": [] } and note it.',
      'Do NOT create, modify, or delete anything. Do NOT enter a worktree. This is read-only.',
    ].join('\n'),
    {
      label: 'discover-corpus',
      phase: 'discover',
      schema: {
        type: 'object',
        required: ['sessions'],
        properties: {
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['session', 'path'],
              properties: {
                session: { type: 'string' },
                path: { type: 'string' },
                workers: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  );

  const sessions = discovery.sessions ?? [];
  if (sessions.length === 0) {
    log(
      'No archived sessions found — nothing to sweep. Returning an empty report.',
    );
    return {
      corpusRoot,
      sessionsRead: [],
      report:
        'EVALUATOR EFFICIENCY SWEEP — no archived sessions found under the corpus root. ' +
        'Either the range is empty or the corpus-archival default ({48.17}) has not run for any session yet.',
    };
  }

  log(
    `Discovered ${sessions.length} archived session(s): ${sessions.map((s) => s.session).join(', ')}`,
  );

  // --- Phase 2: fan out one read-only metric agent per session ------------------------
  // parallel() runs them as a barrier — each agent's per-session metric slice stays in
  // THIS script's variables (the context-offload), never in the orchestrator's context.
  phase('fan-out');
  const slices = await parallel(
    sessions.map(
      (s) => () =>
        agent(
          [
            `You are a read-only efficiency-metric agent for Knowledge Hub session ${s.session}.`,
            `Read ONLY the archived artefacts under "${s.path}" for each worker subdir:`,
            '  - final_report.yaml  -> token_usage_by_role (per-role {input, output, cache_creation, cache_read, total, turn_count}) + token_usage_total. If a role entry is null with a token_usage_note (purged transcript), record token usage UNAVAILABLE for that worker — do NOT fabricate a count.',
            '  - events.jsonl       -> Read-tool events (duplicated reads keyed by file_path), dispatch events (redundant dispatch E1/E6), git events (coordination overhead E3 stale-worktree fetch+reset, E4 ledger-reconciliation conflicts).',
            '  - per-turn token detail for megaturn detection comes from the token roll-up figures in final_report.yaml, NOT derived from events.jsonl.',
            '  - meta.json          -> role + dispatch metadata (incl. session_id).',
            '  - oq-pending.md      -> open questions (context only, not a metric).',
            'Compute the RESEARCH §7 metric set for this session and return the metricSlice object matching the provided schema.',
            'This is READ-ONLY: do NOT create, modify, or delete any file. Do NOT enter a worktree. Do NOT write to the ledger or the retro corpus.',
            'If an artefact is missing/empty/malformed, record it in `escalations` rather than fabricating a value.',
          ].join('\n'),
          {
            label: `metrics-${s.session}`,
            phase: 'fan-out',
            schema: metricSliceSchema,
          },
        ),
    ),
  );

  log(
    `Collected ${slices.length} per-session metric slice(s). Synthesising the §7 report.`,
  );

  // --- Phase 3: synthesise the §7 efficiency report -----------------------------------
  // A single synthesis agent assembles the report from the in-script slices: the
  // per-session metric table + roll-up, top offenders, and the recurring-finding surface
  // (the C5 guard: buckets seen in >= 3 distinct sessions).
  phase('synthesise');
  const report = await agent(
    [
      'You are the synthesis agent for the Knowledge Hub workflow-evaluator efficiency sweep.',
      'You are given an array of per-session metric slices (already computed — do NOT re-read the corpus).',
      'Assemble a markdown efficiency report with these sections IN ORDER:',
      '  1. Header — all FIVE fields, in order: ' +
        '(a) trigger source = "operator-command" (this /workflows sweep is always operator-triggered — a manual saved command); ' +
        '(b) session range (first..last of the sessions read); ' +
        '(c) archived-corpus paths read; ' +
        '(d) timestamp — obtain it yourself via a `date` Bash call (ISO 8601); if an args.timestamp was supplied use that instead; ' +
        '(e) evaluator agent invocation id = the runtime-assigned workflow run id (the wf_... id surfaced in /workflows — record it verbatim as "runtime-assigned workflow run id (see /workflows)"), plus any args.runLabel if one was provided.',
      '  2. Efficiency-metric table — one row per session + a roll-up row (mean +/- stddev per role for token usage).',
      '  3. Top offenders — per metric, the worst-3 with concrete pointers (file path or worker id + evidence pointer).',
      '  4. Recurring-finding surface (the C5 guard) — bucket findings by short canonical key ' +
        '(e.g. duplicated-read::file_path, redundant-dispatch::E1, coordination-overhead::E4); ' +
        'report buckets appearing in >= 3 DISTINCT sessions, with the session numbers + an example evidence pointer.',
      '  5. Recommendations for next O-of-O handoff — bullets, each naming a recurring bucket and a candidate retro framing, ' +
        'EXPLICITLY marked "for handoff consideration; not a retro record".',
      '  6. Escalations — any per-session corpus problems surfaced by the fan-out agents.',
      'Do NOT author a retro record. Do NOT write to product-retros.json. Do NOT dual-write to Mempalace. ' +
        'Do NOT edit the roadmap/backlog. This synthesis returns the report TEXT only.',
      '',
      'Per-session metric slices (JSON):',
      JSON.stringify(slices, null, 2),
    ].join('\n'),
    {
      label: 'synthesise-report',
      phase: 'synthesise',
      // The /workflows surface is always operator-triggered for a manual saved command.
      // triggerSource is a pure literal — no Date.now()/Math.random()/argless new Date()
      // (those THROW inside workflow scripts and would break resume). The Header's
      // timestamp + runtime-assigned workflow run id are obtained by the synthesis AGENT
      // via its own tools (see the Header instruction above), never fabricated here.
      triggerSource: 'operator-command',
    },
  );

  return {
    corpusRoot,
    sessionsRead: sessions.map((s) => s.session),
    report,
  };
}
