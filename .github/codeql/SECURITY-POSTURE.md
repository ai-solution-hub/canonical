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

| Aspect                | State             |
| --------------------- | ----------------- |
| Security updates      | **enabled** ✅    |
| Open security alerts  | **0** ✅          |
| Open version-bump PRs | 3 (triaged below) |

**Triage (S392) — all three assessed SAFE; merges pending product-owner authorization:**

| PR  | Bump                        | Verdict          | Basis                                                                                                                                                                                                  |
| --- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #17 | eslint 9→10 (dev)           | **safe — merge** | flat config already used; all pinned plugins declare eslint-10 peer support (unused-imports@4.4.1 = `^10‖^9‖^8`, react-hooks, eslint-config-next `>=9`, tanstack-query); no eslint-specific CI failure |
| #46 | actions/checkout 4→7        | **safe — merge** | no `pull_request_target`/`workflow_run` workflows (v7 fork-checkout block N/A); node24 on ubuntu-latest                                                                                                |
| #45 | create-github-app-token 1→3 | **safe — merge** | used in docs-dispatch + resolve-private-docs; node24 fine; standard inputs                                                                                                                             |

⚠ **Merge blocker (infra, not the PRs):** the sole required check `ci-summary`
(production-protection ruleset) is **chronically red** — it rolls up non-required infra
jobs (Integration / E2E smoke / MCP staging / Supabase-types-parity, root cause bl-240 /
bl-242 / real-API seeds) that fail on every PR. The merge button is blocked for all three;
merging needs the documented local-merge bypass (`git merge --no-ff origin/<pr-branch>` +
direct push) or admin override.

## Secret scanning

| Aspect                                  | State                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| Secret scanning                         | **enabled** ✅                                                      |
| **Push protection**                     | **DISABLED** ⚠ — recommend enabling (cheap pre-commit secret block) |
| Non-provider patterns / validity checks | disabled (optional hardening)                                       |
| Open alerts                             | **0** ✅                                                            |

## Recommended follow-ups

1. **Enable secret-scanning push protection** (repo Settings → cheap, protective).
2. **Merge the 3 Dependabot PRs** via the local-merge bypass (all assessed safe).
3. **Unblock `ci-summary`** — the chronic non-required reds (bl-240/242) make the only
   required check permanently red, blocking every PR's merge button. Highest-leverage
   posture fix beyond this theme.
4. At Code-Quality GA (2026-07-20): revisit advanced setup (D4) — wire `codeql-config.yml`
   via `codeql-action/init config-file`, re-validating the security-rule exclusions.
