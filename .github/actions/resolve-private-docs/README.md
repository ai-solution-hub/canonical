# resolve-private-docs — CI resolution for `KH_PRIVATE_DOCS_DIR`

The single CI resolution route for the private-docs bridge knob (ID-68 — TECH PC-28;
PRODUCT Inv 25/28/29/30). Mints a GitHub-App installation token via
`actions/create-github-app-token`, checks out `knowledge-hub-docs-site` into
`${{ runner.temp }}/kh-private-docs`, and exports `KH_PRIVATE_DOCS_DIR` for downstream
steps.

Consumers never implement their own resolution (Inv 28): they read the env var via the
bridge helpers only.

## Consumer surfaces

- **TypeScript:** `resolvePrivateDocsDir()` from `@/lib/private-docs` (direct file import
  — no barrel). Throws an actionable error naming the knob and both resolution routes when
  unset (Inv 29 — no fallback to in-repo `docs/`, no partial output).
- **Shell / skill consumers:** the documented one-liner —

  ```sh
  "${KH_PRIVATE_DOCS_DIR:?KH_PRIVATE_DOCS_DIR not set — point it at the knowledge-hub-docs-site checkout (sibling clone locally; GitHub-App token checkout in CI)}"
  ```

  Exits non-zero naming the knob when unset (AC-D3 contract).

## Resolution routes (Inv 28)

| Context                | Route                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local/dev              | Set `KH_PRIVATE_DOCS_DIR` explicitly (in `.env.local` or your shell profile) to the sibling checkout `../knowledge-hub-docs-site`. Never auto-discovered. |
| CI (opt-in lanes only) | This action — GitHub-App installation-token checkout into `${{ runner.temp }}/kh-private-docs`.                                                           |

## Usage

```yaml
- name: Resolve private docs
  uses: ./.github/actions/resolve-private-docs
  with:
    app-id: ${{ secrets.DOCS_SITE_APP_ID }}
    private-key: ${{ secrets.DOCS_SITE_APP_PRIVATE_KEY }}
# Subsequent steps read $KH_PRIVATE_DOCS_DIR from the job env.
```

## Self-sufficiency guard (Inv 30)

No PR-blocking CI job sets this knob — bridge consumers are opt-in lanes only (e.g.
private eval suite, docubot dispatch). The public repo's build, unit tests, and
PR-blocking CI must stay green with the knob unset (AC-D4 / AC-C3). Do not add this action
to any required check.

## Implementation note

`actions/checkout` cannot place a repository outside `$GITHUB_WORKSPACE`, so the
PC-28-mandated `runner.temp` target is materialised with a token-authenticated `git clone`
after the installation token is minted.
