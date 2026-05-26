# Stale terminology — KH docs corpus

The `terminology` sub-audit of `audit_docs.py` flags occurrences of the stale
term (left column) and recommends the canonical replacement (right column).
Keep this list in step with `AGENTS.md` §2 (Terminology) — AGENTS.md is the
canonical source; this table is the machine-readable subset the audit scans.

| Stale term  | Canonical replacement | Notes                                                                 |
| ----------- | --------------------- | --------------------------------------------------------------------- |
| Digest      | Change Reports        | Renamed S248 / S251 W1B. Never emit "Digest" in new prose.            |
| AI-powered  | (remove)              | AI-invisibility: no "AI-powered" badges or copy (AGENTS.md §5).        |
| Sparkles    | (remove)              | AI-invisibility: no Sparkles iconography in user-facing surfaces.      |
| knowledge hub | Knowledge Hub       | Product name is capitalised; never lower-case in body prose.           |
| authorised  | success               | `getAuthorisedClient()` returns `{ success }`, not `{ authorised }`.   |
