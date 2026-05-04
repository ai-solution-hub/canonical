# Quality Shard Failure Triage and MCP Eval Fixture Enablement

## Problem statement

The latest CI run is past the previous gating failures and now exposes the first
real set of quality-shard failures. The next session should separate valuable
behaviour coverage from implementation-coupled or environment-coupled tests,
remove or rewrite low-value tests, and enable MCP evals to run against
deterministic Q&A content instead of passing via the current no-data graceful
skip.

## Current findings

All four quality shards failed in the latest main CI run, but most tests passed
in each shard. The failures cluster into a few categories: brittle
branding/accessibility text assertions, docs/process-coupling checks such as
Last verified enforcement, environment-coupled tests requiring tools like pandoc
or network/DB availability, stale mocks such as missing MAX_EMBEDDING_CHARS on
the embed mock, and some MCP/content search tests that time out or depend on
live data shape. The latest MCP eval L1 job completed successfully only because
`scripts/mcp-eval/fixtures.ts` exited through the no Q&A content_items with
embeddings graceful-skip path. L1/L3/L4 therefore are not yet providing
meaningful eval signal against staging content. The MCP eval workflow now builds
once in a Staging-scoped `mcp-build` job and fan-outs L1/L3/L4 using the shared
build artefact. Each eval job still runs independently and still runs the
orphaned `content_history` cleanup after completion.

## Quality shard triage approach

Start by pulling the latest CI logs and grouping failures by root cause rather
than by shard. For each failing file, classify tests as behaviour-value,
implementation-coupled, environment-coupled, or obsolete. Behaviour-value tests
should be fixed or rewritten around user-visible behaviour.
Implementation-coupled tests should be removed unless they guard a critical
contract that cannot be tested at a higher level. Environment-coupled tests
should move out of the unit quality shards or gain explicit dependency guards.
Initial high-priority candidates are branding/text assertions in component tests
and E2E, docs freshness enforcement tests, tests that assume local pandoc
availability, and tests that import integration/MCP behaviour into unit shards
without reliable isolation. Keep a short rationale for every removed test so the
later full test audit can reuse the classification.

## MCP eval content strategy

Do not start with Snaplet for MCP eval enablement. Snaplet may be useful later
for broad public-schema sample data, but the immediate blocker is a small
deterministic set of `content_items` with `content_type = 'q_a_pair'`,
embeddings, publication visibility that search tools can see, and enough
metadata/domains to exercise the eval queries. A purpose-built seed script is
lower risk and easier to clean up. Do not copy production data directly for the
first pass. If production-derived examples are desired later, create a
sanitised, hand-curated fixture subset rather than a bulk copy. The first pass
should create synthetic Q&A items covering ISO 27001, GDPR/data protection, SLA
response times, support, and implementation topics, then generate embeddings
with the configured embedding model so `search_knowledge_base`,
`search_qa_library`, `find_similar_items`, and `search_content_chunks` have
stable inputs. The fixture seed should either create persistent staging eval
seed rows with a prefix such as `[MCP-EVAL-SEED]` that current cleanup does not
delete, or run as a dedicated `mcp-eval-seed` job before L1/L3/L4 and pass
stable IDs to the eval jobs. Avoid having each matrix job create and delete the
shared Q&A corpus independently because concurrent matrix cleanup can race.
Per-layer temporary write-test items can remain unique to each layer and should
use a run/layer-specific prefix so one layer does not delete another layer's
data.

## Workflow considerations

Keep the Staging environment scope for MCP evals. Add a seed step or seed job
before the eval fan-out, not inside every matrix job, if the seed is shared.
Continue running `cleanup:orphaned-content-history` after each eval job, but
ensure it only removes orphaned `content_history` rows and does not delete
persistent Q&A seed content. If a seed job creates per-run rows instead of
persistent rows, add a final cleanup job that depends on all eval layers and
deletes only that run's seed prefix after the evals finish.

## Session deliverables

Produce a concise failure inventory from the latest CI logs, patch or remove the
highest-signal quality shard failures, add deterministic MCP Q&A seed support,
update the MCP fixture lookup to fail clearly when seeded content is missing,
and rerun the relevant local checks. After merging, the next CI run should show
fewer quality shard failures and MCP evals should report real pass/fail results
rather than no-data skips.
