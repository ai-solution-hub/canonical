# KH feature → doc-path map

Phase-2 draft input: maps a KH feature/surface to the docs-site space + page
where its documentation belongs. When the Phase-1 audit reports a gap, the
Phase-2 draft uses this map to decide WHERE to draft the fill, then reads 2-3
strong existing examples in that space before drafting.

| Surface / feature                | Docs space             | Target page (under docs-site/src/content/docs/)        |
| -------------------------------- | ---------------------- | ------------------------------------------------------ |
| Environment variables            | runbooks               | `runbooks/local-development.md`                        |
| GitHub environments / CI secrets | runbooks               | `runbooks/github-environments.md`                      |
| CLI commands (`bun run …`)        | runbooks               | `runbooks/local-development.md`                        |
| MCP tools / resources / prompts  | reference              | `reference/mcp-inventory.md`                           |
| API routes (`app/api/**`)         | reference              | `reference/api-routes.md`                              |
| Database schema / tables         | reference              | `reference/schema-quick-reference.md`                  |
| Taxonomy / Domain / Sector / Layer | ontology             | `ontology/<vocabulary>.md`                             |
| User-facing capabilities         | product-functionality  | `product-functionality/<feature>/user-journeys.md`     |
| Ratified spec pairs              | decisions              | `decisions/<task-slug>/` (PRODUCT + TECH)              |

Drafting discipline: do not invent behaviour. Cite the source surface that
proves the gap, and follow the content-type style guide (AGENTS.md §4) for the
target space. Open one docs PR per gap cluster.
