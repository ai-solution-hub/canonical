"""Producer SQL executed against a REAL Postgres (ID-427 {427.17}).

WHY THIS FILE EXISTS
--------------------
Every other assertion about this adapter's SQL runs against a per-file
`FakePool` that dispatches on MARKER SUBSTRINGS. A predicate the marker does
not mention is therefore invisible: the S548 adversarial audit dropped
`AND publication_status = 'published'` from two coverage queries and the whole
Python suite stayed GREEN (2395/6), while the executed consequence was
`unrouted (('source_documents', -4),) total -4, is_no_op: False` — a NEGATIVE
count rendered into `log.md`, staging a commit.

`Coverage`'s docstring claims `routed <= considered` is *"structural rather
than defended… which is why no clamp guards it here"*. Structure that no test
executes is prose. These tests execute it.

GATING
------
Collected always, executed only when `KH_RUN_PG_INTEGRATION=1` and
`KH_PG_INTEGRATION_DSN` points at a loopback stack — the `pg_session` fixture
(`conftest.py`) applies DR-131's disposability interlock and skips otherwise,
so the default `python3 -m pytest scripts/tests/` sweep touches no database.

    supabase start
    KH_RUN_PG_INTEGRATION=1 \
    KH_PG_INTEGRATION_DSN=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
    python3 -m pytest scripts/tests/test_producer_sql_integration.py

SEEDING DISCIPLINE
------------------
Every row this file writes carries the `_TEST_PREFIX` marker in its filename /
question text, and `_purge` removes exactly those rows before and after each
test. Nothing here calls a promotion RPC or any other whole-corpus mutation —
the rows seeded are the rows touched (the DR-131 defect class).
"""

from __future__ import annotations

import uuid

from scripts.cocoindex_pipeline.sources.l_records import (
    LRecordsSource,
    Q_A_PAIRS,
    SOURCE_DOCUMENTS,
    _SQL_CENSUS_CORPUS_TOTALS,
    _SQL_COVERAGE_PUBLISHED_QA_BY_PATTERNS_OR_TAGS,
    _SQL_COVERAGE_PUBLISHED_SD_BY_PATTERNS,
    _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY,
    _SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS,
    _SQL_SOURCE_DOCUMENTS_BY_IDS,
)

_TEST_PREFIX = "zzz-id427-sqlprobe"


async def _purge(pool) -> None:  # type: ignore[no-untyped-def]
    """Remove this file's own rows. Scoped by the test prefix, never global."""
    await pool.execute(
        "DELETE FROM public.q_a_pairs WHERE question_text LIKE $1",
        f"{_TEST_PREFIX}%",
    )
    await pool.execute(
        "DELETE FROM public.source_documents WHERE filename LIKE $1",
        f"{_TEST_PREFIX}%",
    )


async def _seed_document(
    pool,  # type: ignore[no-untyped-def]
    *,
    slug: str,
    publication_status: str,
) -> uuid.UUID:
    """INSERT one `source_documents` row in a chosen publication state.

    `content_hash` is per-slug distinct: DR-133 records that content-hash-first
    identity makes a byte-identical re-stage resolve onto an existing row, which
    would silently collapse two fixtures into one.
    """
    row_id = uuid.uuid4()
    await pool.execute(
        "INSERT INTO public.source_documents "
        "(id, filename, mime_type, file_size, content_hash, storage_path, "
        " publication_status) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        row_id,
        f"{_TEST_PREFIX}-{slug}.md",
        "text/markdown",
        128,
        f"{_TEST_PREFIX}-{slug}-hash",
        f"{_TEST_PREFIX}/{slug}.md",
        publication_status,
    )
    return row_id


async def _seed_pair(
    pool,  # type: ignore[no-untyped-def]
    *,
    slug: str,
    publication_status: str,
    source_document_id: uuid.UUID | None = None,
) -> uuid.UUID:
    row_id = uuid.uuid4()
    await pool.execute(
        "INSERT INTO public.q_a_pairs "
        "(id, question_text, answer_standard, publication_status, "
        " source_document_id) "
        "VALUES ($1, $2, $3, $4, $5)",
        row_id,
        f"{_TEST_PREFIX}-{slug}?",
        f"{_TEST_PREFIX}-{slug} answer",
        publication_status,
        source_document_id,
    )
    return row_id


class TestTheCensusCorpusDefinitionIsExecuted:
    """`_SQL_CENSUS_CORPUS_TOTALS` is the `considered` half — the corpus
    definition TECH §2.1's ratified residual anti-join also uses. If its
    `publication_status` predicate is lost, `considered` inflates, `routed`
    does not, and the run reports phantom unrouted units."""

    def test_considered_counts_published_units_only(self, pg_session) -> None:
        """The assertion `FakePool` structurally cannot make.

        A marker-dispatching fake returns whatever rows the test registered
        regardless of the predicate, so it agrees with the query and with its
        mutant alike. Real Postgres does not.
        """

        async def body(pool):
            await _purge(pool)
            before = (await pool.fetch(_SQL_CENSUS_CORPUS_TOTALS))[0]

            await _seed_document(slug="published-doc", publication_status="published", pool=pool)
            await _seed_document(slug="draft-doc", publication_status="draft", pool=pool)
            await _seed_document(slug="review-doc", publication_status="in_review", pool=pool)
            await _seed_document(slug="archived-doc", publication_status="archived", pool=pool)
            await _seed_pair(slug="published-pair", publication_status="published", pool=pool)
            await _seed_pair(slug="draft-pair", publication_status="draft", pool=pool)

            after = (await pool.fetch(_SQL_CENSUS_CORPUS_TOTALS))[0]
            await _purge(pool)
            return before, after

        before, after = pg_session(body)

        # Four documents seeded, ONE published. Two pairs seeded, ONE published.
        assert after[SOURCE_DOCUMENTS] - before[SOURCE_DOCUMENTS] == 1, (
            "census `considered` counted an unpublished source_document — the "
            "corpus definition and TECH §2.1's residual anti-join have diverged"
        )
        assert after[Q_A_PAIRS] - before[Q_A_PAIRS] == 1, (
            "census `considered` counted an unpublished q_a_pair"
        )

    def test_the_census_query_returns_exactly_one_row_of_two_scalars(
        self, pg_session
    ) -> None:
        """Its docstring claims "one query, one row, two scalars". The shape is
        load-bearing: `census()` indexes `rows[0]` unguarded beyond an empty
        check, so a shape change is an IndexError in a nightly, not a test."""

        async def body(pool):
            return await pool.fetch(_SQL_CENSUS_CORPUS_TOTALS)

        rows = pg_session(body)
        assert len(rows) == 1
        assert set(rows[0].keys()) == {SOURCE_DOCUMENTS, Q_A_PAIRS}


class TestTheCoverageQueriesAreExecuted:
    """THE S548 finding, executed.

    Reproduced independently this session: dropping
    `AND publication_status = 'published'` from BOTH coverage queries leaves
    the full `FakePool` suite green — **2464 passed, 11 skipped**. `FakePool`
    matches on substring markers that exclude the predicate, so the SQL never
    reaches Postgres and the mutant is indistinguishable from the original.

    The executed consequence the audit recorded: `routed` counts unpublished
    units while `considered` does not, so `unrouted` goes NEGATIVE
    (`(('source_documents', -4),) total -4, is_no_op: False`) and renders into
    `log.md`, staging a commit. `Coverage`'s docstring calls
    `routed <= considered` *"structural rather than defended"*. These tests are
    the defence, or at least the detection.
    """

    def test_document_coverage_counts_published_documents_only(
        self, pg_session
    ) -> None:
        async def body(pool):
            await _purge(pool)
            published = await _seed_document(
                slug="cov-published", publication_status="published", pool=pool
            )
            await _seed_document(
                slug="cov-draft", publication_status="draft", pool=pool
            )
            await _seed_document(
                slug="cov-archived", publication_status="archived", pool=pool
            )
            rows = await pool.fetch(
                _SQL_COVERAGE_PUBLISHED_SD_BY_PATTERNS, [f"{_TEST_PREFIX}-cov-%"]
            )
            await _purge(pool)
            return [r["id"] for r in rows], published

        returned, published = pg_session(body)
        assert returned == [published], (
            "document coverage counted an unpublished row as routed — this is "
            "the S548 mutation, and it makes `unrouted` go negative"
        )

    def test_pair_coverage_counts_published_pairs_only(self, pg_session) -> None:
        async def body(pool):
            await _purge(pool)
            doc = await _seed_document(
                slug="covqa-doc", publication_status="published", pool=pool
            )
            published = await _seed_pair(
                slug="covqa-published",
                publication_status="published",
                source_document_id=doc,
                pool=pool,
            )
            await _seed_pair(
                slug="covqa-draft",
                publication_status="draft",
                source_document_id=doc,
                pool=pool,
            )
            rows = await pool.fetch(
                _SQL_COVERAGE_PUBLISHED_QA_BY_PATTERNS_OR_TAGS,
                [f"{_TEST_PREFIX}-covqa-%"],
                [],
            )
            await _purge(pool)
            return [r["id"] for r in rows], published

        returned, published = pg_session(body)
        assert returned == [published]

    def test_routed_never_exceeds_considered_for_a_seeded_corpus(
        self, pg_session
    ) -> None:
        """The invariant `Coverage` claims is structural, asserted end to end
        over rows whose publication states are known. Under the S548 mutation
        the coverage side counts 3 documents while the census counts 1, and
        this assertion is what turns that into a red test instead of a
        negative number in `log.md`."""

        async def body(pool):
            await _purge(pool)
            base = (await pool.fetch(_SQL_CENSUS_CORPUS_TOTALS))[0]
            for slug, status in (
                ("inv-a", "published"),
                ("inv-b", "draft"),
                ("inv-c", "in_review"),
                ("inv-d", "archived"),
            ):
                await _seed_document(slug=slug, publication_status=status, pool=pool)
            considered = (await pool.fetch(_SQL_CENSUS_CORPUS_TOTALS))[0]
            covered = await pool.fetch(
                _SQL_COVERAGE_PUBLISHED_SD_BY_PATTERNS, [f"{_TEST_PREFIX}-inv-%"]
            )
            await _purge(pool)
            return (
                considered[SOURCE_DOCUMENTS] - base[SOURCE_DOCUMENTS],
                len(covered),
            )

        considered_delta, routed = pg_session(body)
        # FLOOR FIRST. The S550 adversarial audit over-filtered both coverage
        # queries to `publication_status = 'zzz_never'` — a totally dead
        # coverage query — and this test PASSED on `0 <= 1`. The one test
        # whose stated purpose is to defend `routed <= considered` was
        # satisfied by coverage returning nothing at all.
        assert routed == 1, (
            f"coverage returned {routed} for a corpus seeded with exactly one "
            "published document — the invariant below is vacuous unless "
            "coverage is actually reaching something"
        )
        assert routed <= considered_delta, (
            f"routed ({routed}) exceeded considered ({considered_delta}) — "
            "`unrouted` would render negative"
        )


class TestTheAuditorsUndecidableOnTheUnfilteredInnerSubquery:
    """Answers the {427.17} UNDECIDABLE, carried verbatim:

        *"Does {427.9}'s `Coverage` 'subset of the CORPUS, not of everything a
        read touches' hold for `_SQL_COVERAGE_PUBLISHED_QA_BY_PATTERNS_OR_TAGS`,
        whose inner document subquery is deliberately unfiltered ('it
        reproduces the id list the read actually passes') while the outer
        clause filters `publication_status`? I could not determine whether an
        unpublished parent document can yield a published pair that the read
        never actually reaches — which would make that grain's `routed` an
        overcount against a corpus it does not read. Answering needs the query
        executed against Postgres with a published-pair/unpublished-parent row,
        which no test in this repo does."*

    That row is seeded below and the query is executed. The answer is
    conditional on {427.15}, which is exactly why it was undecidable from the
    test corpus: **today** the inner subquery mirrors the read (both
    unfiltered), so coverage is honest; **after** {427.15} filters the document
    read, the read stops reaching the pair while coverage still counts it, and
    the docstring's "reproduces the id list the read actually passes" becomes
    false. These tests pin both halves so {427.15} cannot land the divergence
    silently.
    """

    def test_a_published_pair_under_an_unpublished_parent_is_not_counted(
        self, pg_session
    ) -> None:
        async def body(pool):
            await _purge(pool)
            orphan_parent = await _seed_document(
                slug="undec-parent", publication_status="draft", pool=pool
            )
            await _seed_pair(
                slug="undec-pair",
                publication_status="published",
                source_document_id=orphan_parent,
                pool=pool,
            )
            # POSITIVE CONTROL, in the same body and the same pattern scope.
            # Without it the assertion below is satisfied by the coverage
            # query being dead — which the S550 audit demonstrated by
            # over-filtering it to `publication_status = 'zzz_never'`.
            good_parent = await _seed_document(
                slug="undec-goodparent", publication_status="published", pool=pool
            )
            control = await _seed_pair(
                slug="undec-goodpair",
                publication_status="published",
                source_document_id=good_parent,
                pool=pool,
            )
            covered = await pool.fetch(
                _SQL_COVERAGE_PUBLISHED_QA_BY_PATTERNS_OR_TAGS,
                [f"{_TEST_PREFIX}-undec-%"],
                [],
            )
            await _purge(pool)
            return [r["id"] for r in covered], control

        covered, control = pg_session(body)
        assert covered == [control], (
            "coverage must count the published pair under a PUBLISHED parent "
            "(the control) and NOT the one whose only lineage is an "
            "unpublished parent — the read cannot reach the latter, which is "
            "the overcount the {427.17} auditor named. Getting [] here means "
            "the coverage query is dead, not that the filter works."
        )

    def test_coverage_and_read_agree_after_the_filter_landed(
        self, pg_session
    ) -> None:
        """The half that resolved the UNDECIDABLE, and the regression net for
        it.

        Authored before {427.15} asserting the OPPOSITE — that the read did
        reach the pair, so coverage was honest. Landing DR-143's predicate
        flipped it, exactly as predicted: the unpublished parent left the
        document id list, the read stopped reaching the pair, and coverage's
        docstring claim to reproduce *"the id list the read actually passes"*
        became false. That is the overcount the auditor could not measure.

        The fix filtered the coverage query's inner document subquery to
        mirror the read. This test now pins BOTH sides together — neither may
        move without the other — which is what the auditor's question was
        really asking for.
        """

        async def body(pool):
            await _purge(pool)
            orphan_parent = await _seed_document(
                slug="undec2-parent", publication_status="draft", pool=pool
            )
            await _seed_pair(
                slug="undec2-pair",
                publication_status="published",
                source_document_id=orphan_parent,
                pool=pool,
            )
            # POSITIVE CONTROL. Every assertion in this test used to be
            # `== []`, so it could not tell "coverage now mirrors the read"
            # from "both queries return nothing at all" — the S550 audit
            # proved it passes with both coverage queries over-filtered to
            # match nothing. It was the most vacuous of the ten, and it is
            # the one that supposedly resolves the {427.17} UNDECIDABLE.
            good_parent = await _seed_document(
                slug="undec2-goodparent", publication_status="published", pool=pool
            )
            control = await _seed_pair(
                slug="undec2-goodpair",
                publication_status="published",
                source_document_id=good_parent,
                pool=pool,
            )
            doc_rows = await pool.fetch(
                _SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS,
                [f"{_TEST_PREFIX}-undec2-%"],
            )
            doc_ids = [r["id"] for r in doc_rows]
            read_rows = await pool.fetch(
                _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY, doc_ids, "__no_such_tag__"
            )
            covered = await pool.fetch(
                _SQL_COVERAGE_PUBLISHED_QA_BY_PATTERNS_OR_TAGS,
                [f"{_TEST_PREFIX}-undec2-%"],
                [],
            )
            await _purge(pool)
            return (
                doc_ids,
                [r["id"] for r in read_rows],
                [r["id"] for r in covered],
                good_parent,
                control,
            )

        doc_ids, read_ids, covered_ids, good_parent, control = pg_session(body)
        assert doc_ids == [good_parent], (
            "the document read must pass the PUBLISHED parent and drop the "
            "unpublished one; [] here means the read is dead, not filtered"
        )
        assert read_ids == [control], (
            "the pair read must reach the control pair and not the one under "
            "an unpublished parent"
        )
        assert covered_ids == [control], (
            "coverage and the read must agree — coverage counting a pair the "
            "read cannot reach makes `routed` an overcount and `unrouted` "
            "under-report what the bundle left behind, which is the negative "
            "answer DR-141 requires to be trustworthy"
        )


class TestTheFingerprintTracksTheSameCorpusAsTheRead:
    """The pairing DR-143's filter broke, and the regression net for it.

    **Found by the S550 adversarial audit, after {427.15} shipped.**
    `source_documents` has **no `updated_at` trigger** (verified against
    `pg_trigger`: only `trg_coerce_empty_classification_to_null` and
    `trg_record_lifecycle_mint_source_document`), and no app path sets it on
    a publication change. So flipping `publication_status` moves neither
    `max(sd.updated_at)` nor an unfiltered `count(DISTINCT sd.id)`.

    Before {427.15} the read was unfiltered too, so a status flip changed
    neither the content nor the fingerprint — a matched pair. Filtering the
    read while leaving the `*_VERSION` fingerprints unfiltered **broke the
    pairing**: publishing a document changed what a concept's read returned
    **without moving its `content_version`**, so cocoindex never re-drafted
    it. *Publishing a document silently failed to enter the concept it
    belongs to* — DR-143's own requirement failing in the mirror direction.

    {427.15}'s commit message argued the split was safe because the
    fingerprints are "memo-invalidation, not admission reads". That is
    backwards, and this test is why: once the read is publication-dependent
    and the fingerprint is not, they are no longer independent concerns.
    """

    def test_publishing_a_document_moves_the_company_concept_fingerprint(
        self, pg_session
    ) -> None:
        async def body(pool):
            await _purge(pool)
            await _seed_document(
                slug="company-overview-alpha",
                publication_status="published",
                pool=pool,
            )
            await _seed_document(
                slug="company-overview-beta", publication_status="draft", pool=pool
            )
            source = LRecordsSource(pool)
            before_keys = [
                k for k in await source.list_concepts() if k.concept_type == "company"
            ]
            before_raw = await source.read_concept(before_keys[0])

            await pool.execute(
                "UPDATE public.source_documents SET publication_status = 'published' "
                "WHERE filename LIKE $1",
                f"{_TEST_PREFIX}-company-overview-beta%",
            )

            after_source = LRecordsSource(pool)
            after_keys = [
                k
                for k in await after_source.list_concepts()
                if k.concept_type == "company"
            ]
            after_raw = await after_source.read_concept(after_keys[0])
            await _purge(pool)
            return (
                before_keys[0].content_version,
                after_keys[0].content_version,
                len(before_raw.source_documents or []),
                len(after_raw.source_documents or []),
            )

        v_before, v_after, docs_before, docs_after = pg_session(body)

        # The control: publishing genuinely changed what the concept reads.
        assert (docs_before, docs_after) == (1, 2), (
            "the read did not change when the second document was published "
            "— the fingerprint assertion below would be vacuous"
        )
        assert v_before != v_after, (
            "publishing a document changed the concept's content but NOT its "
            "content_version, so cocoindex will not re-draft it — the "
            "document silently fails to enter the concept it belongs to"
        )


class TestCq1TheSourceDocumentReadsAdmitUnpublishedRows:
    """CQ-1 / **DR-143** — an unpublished `source_document` may not back or be
    cited by a concept. Both pattern-matched reads carried NO
    `publication_status` predicate while every `q_a_pairs` read filtered to
    `published`.

    These are {427.15}'s acceptance tests. They were authored BEFORE the fix
    as `xfail(strict=True)` and failed, which is what proved the defect real
    rather than the fixture broken; landing the predicate flipped them to
    XPASS and strict xfail turned that into a failure, which is what forced
    the markers off. They now assert the fixed behaviour directly.

    The class name is kept as the historical record of what was wrong. The
    third test that pinned the defect's presence is deleted, per its own
    instruction — it existed only to make the two xfails evidence.
    """

    def test_by_ids_read_excludes_an_unpublished_document(self, pg_session) -> None:
        async def body(pool):
            await _purge(pool)
            published = await _seed_document(
                slug="byids-published", publication_status="published", pool=pool
            )
            draft = await _seed_document(
                slug="byids-draft", publication_status="draft", pool=pool
            )
            rows = await pool.fetch(
                _SQL_SOURCE_DOCUMENTS_BY_IDS, [published, draft]
            )
            await _purge(pool)
            return [r["id"] for r in rows], published

        returned, published = pg_session(body)
        assert returned == [published]

    def test_filename_pattern_read_excludes_an_unpublished_document(
        self, pg_session
    ) -> None:
        async def body(pool):
            await _purge(pool)
            published = await _seed_document(
                slug="pattern-published", publication_status="published", pool=pool
            )
            await _seed_document(
                slug="pattern-draft", publication_status="draft", pool=pool
            )
            rows = await pool.fetch(
                _SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS,
                [f"{_TEST_PREFIX}-pattern-%"],
            )
            await _purge(pool)
            return [r["id"] for r in rows], published

        returned, published = pg_session(body)
        assert returned == [published]

    def test_over_filtering_guard_a_published_document_still_reads(
        self, pg_session
    ) -> None:
        """{427.15}'s stated guard against over-filtering. The predicate must
        remove unpublished rows and nothing else — a filter that returned
        nothing would satisfy both tests above vacuously."""

        async def body(pool):
            await _purge(pool)
            published = await _seed_document(
                slug="guard-published", publication_status="published", pool=pool
            )
            rows = await pool.fetch(
                _SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS,
                [f"{_TEST_PREFIX}-guard-%"],
            )
            await _purge(pool)
            return [r["id"] for r in rows], published

        returned, published = pg_session(body)
        assert returned == [published]
