# Intent specialist agents — reference replicas

These eight files are **reference replicas**. The agents that actually run live
inside the Intent UI, which owns its own copies. Liam edits them there and copies
the result across to this directory.

**Never edit a file here expecting it to change agent behaviour.** An edit made
here changes the reference only; the live agent keeps running the Intent-side
copy. To change behaviour, edit in Intent first, then mirror the change here so
the reference stays true.

They are tracked so a Claude Code session working on dev workflow can read what
the Intent specialists are actually instructed to do — before S507 that was
impossible, because the only copies were machine-local, under the gitignored
`.user-scratch/` surface.

## Stock vs owner-ruled

Seven of the eight are **verbatim upstream Intent stock**, with zero local edits:
`coordinator.md`, `developer.md`, `implementor.md`, `pr-reviewer.md`,
`pr-shepherd.md`, `ralph.md`, `ui-designer.md`.

`verifier.md` carries **one owner ruling** — Hard Rule 6 (line ~18), the DR-062
carve-out:

> **"Compose existing backend only" is NOT binding (DR-062).** Never fail a task
> solely for adding backend (route, RPC, migration, helper) the specified
> behaviour requires — judge the behaviour, flag surprises as findings.

That line is the whole local delta across the directory. An upstream refresh that
overwrites `verifier.md` **silently drops a ratified decision** — re-apply Hard
Rule 6 after any refresh. DR-062 names this file as one of its two action sites
(the other is `.dev-workflow/sdlc/.claude/agents/task-checker.md`, the Claude Code
path); the ADR of record is
`reference/decisions/dr-062-compose-existing-backend-not-binding.md` in the
private docs-site.

## Not Claude Code agent definitions

None of these files carry the `name` / `description` YAML frontmatter a Claude
Code subagent definition requires — they are Intent's own format. They live under
`.claude/agents/` because that is where agent definitions belong, not because they
are dispatchable here. Treat anything this directory surfaces in an agent picker
as an artefact of the location, not an invitation to dispatch it.
