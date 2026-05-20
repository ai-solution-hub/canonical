# Skill routing (§4.4)

Orchestrator baseline skill catalogue + the rule for adding Task-specific
skills on demand. Consult when planning a Task's dispatch briefs.

The Orchestrator's baseline skill catalogue — these load with the skill
itself, no per-Task selection required:

- **`start-session`** — bootstrap: git hygiene, critical-doc read, session
  plan summary. Chains into this skill.
- **`context-engineering`** — loadout tuning when the session opens. Used
  when Liam wants to adjust which skills are loaded for the session ahead.
- **`session-driver-cmux`** — fleet dispatch primitive (§5.3). For every
  Executor / Checker / Curator dispatched in a wave > 1.
- **`spec-driven-implementation`** — invoked when a Task with unspec'd
  surface area lands. Creates the spec-authoring subtask chain.
- **`diagnose-ci-failures`** — when CI returns red on the Task's PR.
  Returns a fix plan; the Orchestrator dispatches a fix-Executor against
  it.
- **`update-docs`** — end-of-session: roadmap, state-of-the-product,
  generated stats, backlog updates.
- **`handoff`** — end-of-session: continuation-prompt for the next session.

**Task-specific skills added on demand by Liam (per Q-PLANNER-SKILLS-1
ratification):** the Orchestrator does not pre-load every potentially-useful
skill. Consult `docs/reference/skill-routing-map.md` to look up which skills
fit the Task's tilt (AI, CI, Supabase, Frontend, Data-pipeline, etc.) —
Required vs Conditional vs Anti-pattern columns tell you what to name in the
dispatch brief. This stays user-driven — the map is a lookup, not a forcing
function (Workflow Evaluator role deferred per §9.2 of the canonical doc).

When dispatching a Planner, Executor, or Checker, the Orchestrator names
the relevant skills in the dispatch brief. Sub-agents do not auto-discover
skills from the loaded catalogue — they invoke what they're told to invoke.
