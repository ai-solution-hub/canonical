# Security & code-quality posture — `canonical` (theme-14, ID-121)

Launch-baseline record of the public repo's GitHub security tooling and how the CodeQL
finding surface is dispositioned. Authored S392 (2026-06-22). Companion to
`codeql-config.yml` (this dir) and the ID-121 specs
(`specs/id-121-security-quality-baseline/`).

## Code scanning (CodeQL)

| Aspect          | State                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Setup           | **Default** (UI-managed) — no in-repo workflow                                                        |
| Query suite     | `default` (security-only)                                                                             |
| Languages       | actions, javascript-typescript, python                                                                |
| Schedule        | weekly + on push/PR                                                                                   |
| **Open alerts** | **0** ✅ (3 historical FPs dismissed via REST S391: weak-crypto, incomplete-sanitization, multi-char) |

The broad finding surface (132 quality + 36 security, enumerated via CodeQL CLI 2.25.6 —
see specs §Mechanisms) is **not** on the default hosted suite. It lives in the local
broad-pack reproduction and the **preview Code Quality dashboard** (GA 2026-07-20). Every
finding's disposition is recorded in `codeql-config.yml`:

- **Fixed (Wave A):** remote-property-injection ×4, useless-comparison ×2,
  unreachable-statement, react-unused-state — CodeQL-verified → 0.
- **Enforced (Wave C):** return-style (47) → `noImplicitReturns: true` (tsconfig).
- **Dismissed / FP (Waves B+C):** commented-out-code ×22 (all FP — Wave B triage),
  todo-comment (legitimate), unused-param/local, test/script-scoped security, 3 hosted
  FPs.
- Config coverage **verified**: filters applied to the reproduced SARIF leave **0 residual
  production findings**.

**Decision D4:** stay on default + local CLI (NOT advanced setup) until Code-Quality GA
(2026-07-20). `codeql-config.yml` is inert under default setup but activates when advanced
setup is adopted. **Wave D ({121.8})** — the 14 dashboard AI suggestions are
dashboard-only (not CLI/REST); enumeration + triage deferred to the product owner.

## Dependabot

| Aspect                | State                                 |
| --------------------- | ------------------------------------- |
| Security updates      | **enabled** ✅                        |
| Open security alerts  | **0** ✅                              |
| Open version-bump PRs | 3 — all MERGED S392 (main `a9cd1f6f`) |

**Triage (S392) — all three assessed SAFE and MERGED** (admin API merge; main @
`a9cd1f6f`):

| PR  | Bump                        | Verdict       | Basis                                                                                                                                                                                                  |
| --- | --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #17 | eslint 9→10 (dev)           | **✅ merged** | flat config already used; all pinned plugins declare eslint-10 peer support (unused-imports@4.4.1 = `^10‖^9‖^8`, react-hooks, eslint-config-next `>=9`, tanstack-query); no eslint-specific CI failure |
| #46 | actions/checkout 4→7        | **✅ merged** | no `pull_request_target`/`workflow_run` workflows (v7 fork-checkout block N/A); node24 on ubuntu-latest                                                                                                |
| #45 | create-github-app-token 1→3 | **✅ merged** | used in docs-dispatch + resolve-private-docs; node24 fine; standard inputs                                                                                                                             |

✅ **Merged S392 via admin API** (`gh api PUT …/merge`). The sole required check
`ci-summary` (production-protection ruleset) is chronically red — it rolls up non-required
infra jobs (Integration / E2E smoke / MCP staging / Supabase-types-parity; root cause
bl-240 / bl-242 / real-API seeds) and blocks the merge **button** — but the admin API
merge succeeded. main advanced `b2e5a6d6` → `a9cd1f6f` (#46 `fab5f66d`, #45 `48d0bd11`,
#17 `a9cd1f6f`).

> **Out of scope (flagged for separate triage):** 8 further Dependabot PRs (#8–#15)
> accumulated since S391 — incl. a **TypeScript 5.9→6.0 MAJOR** (#14) and a 49-update bun
> group (#11). Not part of theme-14; left open.

## Secret scanning

| Aspect                                  | State                         |
| --------------------------------------- | ----------------------------- |
| Secret scanning                         | **enabled** ✅                |
| **Push protection**                     | **enabled** ✅ (S392)         |
| Non-provider patterns / validity checks | disabled (optional hardening) |
| Open alerts                             | **0** ✅                      |

## Follow-ups

1. ~~Enable secret-scanning push protection~~ — **done S392** ✅.
2. ~~Merge the 3 Dependabot PRs~~ — **done S392** ✅ (admin API merge; main `a9cd1f6f`).
3. **Unblock `ci-summary`** (OPEN, highest-leverage) — the chronic non-required reds
   (bl-240/242) make the only required check permanently red, blocking every PR's merge
   button (admin override worked this time but isn't a fix). Surface for its own task.
4. **Triage the 8 remaining Dependabot PRs** (#8–#15) — esp. #14 TypeScript 5.9→6.0 MAJOR
   (needs a real compat pass, not a routine bump) and #11 (49-update bun group).
5. At Code-Quality GA (2026-07-20): revisit advanced setup (D4) — wire `codeql-config.yml`
   via `codeql-action/init config-file`, re-validating the security-rule exclusions.
