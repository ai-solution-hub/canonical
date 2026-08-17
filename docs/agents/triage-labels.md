# Triage Labels

The skills speak in five canonical triage roles. Here they are applied as **ordna
`tags:`** in task-file frontmatter. Ordna has no label registry — nothing to
pre-create; a tag exists once written. Filter the queue: `ordna list -t needs-triage`.

| Label in mattpocock/skills | In our tracker                    | Meaning                                                                        |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `needs-triage`             | tag `needs-triage`                | Maintainer needs to evaluate                                                   |
| `needs-info`               | tag `needs-info`                  | Waiting on reporter for more information                                       |
| `ready-for-agent`          | tag `ready-for-agent`             | Fully specified, ready for an AFK agent                                        |
| `ready-for-human`          | tag `ready-for-human`             | Requires human implementation                                                  |
| `wontfix`                  | tag `wontfix` + status `archived` | Not actioned — the archived flip removes it from the board (Coordinator action) |

These sit alongside ordna's own qualifier tags (`ready`, `blocked`, `spec-needed`,
`needs-research`, `parked` — `tasks/AGENTS.md` §2): triage tags record queue state;
qualifier tags record why.

**Invocation note:** `/triage` — like `to-tickets`, `to-spec`, `wayfinder`, and
`grill-with-docs` — is user-invoked by design (`disable-model-invocation: true`; see
the plugin's `.agents/invocation.md`). The owner types the slash command; agents
cannot self-invoke it. The queue is processed whenever a session is asked to run
`/triage`.
