# Automation never touches a shared database

Crosswalk: DR-096, DR-131, DR-103

## Context

Automated lanes that write to a shared database routinely exceed the rows they seeded. A
nightly job fired the authoritative knowledge-admission gate — an RPC that claims every
eligible row database-wide — against shared staging, publishing and embedding mock records into
57% of a live table, polluting search results on every real query and inflating a downstream
dedup pass until it exceeded its job cap. Separately, a destructive sweep shipped a guard that
refused only the production target and so failed **open** when its environment variable was
unset.

## Decision

A test lane that mutates data beyond the rows it seeds runs against a disposable local database
(`supabase start` + `db reset` on the runner), enforced at the suite boundary by refusing any
non-loopback host. A script that deletes or rewrites rows requires a positively supplied
expected-target identifier and refuses unless the live connection target matches it.

## Alternatives considered

- **Hosted preview branches as the test substrate** — rejected: only one branch-creation mode
  runs seeding at all, and the local stack is the only substrate where `config.toml` is
  deterministically authoritative.
- **Move only the offending suite to its own lane** — rejected: a second config, workflow and
  environment block for the same two minutes, plus the env drift that follows.
- **Denylist-only guards ("refuse production")** — rejected: they fail open on a missing
  variable and protect only the environment they name, so every other wrong target passes.
- **Interactive confirmation** — not viable for automation-invoked scripts.

## Consequences

- Absence of a guard input is a refusal, never a pass. Denylists may be kept in addition, but
  are never sufficient alone.
- The invoking workflow supplies the expected identifier explicitly, so the authorisation is
  visible and auditable at the call site.
- Hosted branches are preview and staging surfaces, not test substrates.
- Assertions that were weakened to tolerate shared-database accumulation can be tightened.
- New destructive scripts copy the allowlist shape; review treats a denylist-only or
  env-presence guard on a destructive path as a defect. Existing scripts come under the rule as
  they are next touched.
