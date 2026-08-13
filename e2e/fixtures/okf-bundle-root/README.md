# E2E `OKF_BUNDLE_ROOT` fixture root (id-439)

`playwright.config.ts` points the app's `OKF_BUNDLE_ROOT` at **this directory** for the
browser suite, so `e2e/tests/okf-concept-detail.spec.ts` has a real OKF bundle on disk to
open — the `/okf/[bundleId]` viewer reads the filesystem, not the database, for its concept
graph (`app/api/okf/[bundleId]/graph/route.ts`). This file sits at the ROOT (the parent of
the bundle directories), which `lib/okf/enumerate-bundles.ts` never walks — only immediate
SUBDIRECTORIES are bundles.

## `okf-v02-e2e/` — provenance

Every `.md` under `okf-v02-e2e/` is a **byte-verbatim copy** of the real regenerated v0.2
bundle produced by the closing id-426/id-448 producer run (opId `0f9e494b`, 12/08/2026),
pulled from the platform-staging pipeline box. Nothing is hand-written: `index.md` is the
real bundle index with its bullet list narrowed to the four concepts carried here (its
`okf_version: "0.2"` frontmatter and every retained bullet are untouched), and
`ontology.json` is the real artefact (`{"overlay": null}` → `bundleClass: 'platform'`).
This directory is therefore prettier-ignored (see `.prettierignore`): re-wrapping the prose
would stop it being a copy of producer output, which is the property that makes the spec
evidence rather than decoration.

The four concepts are the smallest set that carries **both generations at once** — the
mixed-generation bundle OKF v0.2 §11 tolerance exists for (the same run left 11 v0.1
concepts in place where the augmentation guard refused to rewrite them):

| Concept                      | Generation | What it carries                                                                                        |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `topics/data-protection`     | v0.2       | `generated` + `sources[]`: one `canonical://q_a_pairs?scope_tag=…` entry + three bundle-path citations. |
| `certifications/iso-27001`   | v0.2       | `generated` + `sources[]`: two `canonical://source_documents/<uuid>` entries + four bundle-path ones.   |
| `topics/quality-management`  | v0.1       | Legacy `timestamp` + `confidence` + top-level `resource:` + a `# Citations` trailer, and NO `sources[]`. |
| `company/overview`           | v0.1       | Legacy shape again; also the `sources[]` link target both v0.2 concepts cite.                            |

The `canonical://` pointers resolve against the **Platform staging** database
(`rbwqewalexrzgxtvcqrh`) that `.env.local` targets — the same DB the producer run wrote, so
the `source_documents` rows behind those UUIDs are real rows (verified S562:
`19ca3b4b-…` → `synthetic-compliance-certifications.md`, `9c56fcc6-…` →
`synthetic-company-overview.md`). A staging wipe would break the resource-lane test
honestly rather than silently, which is the same posture `guide-pages.spec.ts` takes to
seeded guides.

Some `sources[]` entries deliberately point at concepts NOT copied here (e.g.
`/certifications/iso-9001-2015.md`). That is not an omission: an entry whose target is
absent from the bundle must render as plain text rather than a dead link, and the spec
asserts exactly that.

## Pointing the spec at a different bundle

`E2E_OKF_BUNDLE_ROOT` overrides this root and `E2E_OKF_BUNDLE_ID` the bundle id, so the
same spec can be run against a full real bundle tree without editing anything:

```bash
PORT=3011 PLAYWRIGHT_WEB_SERVER_PORT=3011 PLAYWRIGHT_BASE_URL=http://localhost:3011 \
NEXT_DIST_DIR=.next-1 \
E2E_OKF_BUNDLE_ROOT=/abs/path/to/bundle-parent E2E_OKF_BUNDLE_ID=my-bundle \
bunx playwright test e2e/tests/okf-concept-detail.spec.ts --project=chromium-desktop
```

The overriding tree must carry the four concepts above (a real regenerated bundle does —
they are copied out of one).
