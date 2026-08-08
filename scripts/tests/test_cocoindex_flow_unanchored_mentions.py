"""An entity mention the document does not support is refused (Inv-17, S543).

`flow.py` writes `entity_mentions.context_snippet` from
`entity_context.entity_context_for_mention`, which returns `''` when the
extractor's name occurs nowhere in `content_text` and its declared span does
not bracket it either. Until S543 that empty string was written to the column.

The owner ruled it unadmissible, and the reason is what the column is FOR
rather than what it is. Its live consumer is `producer/enrich.py`: a mention's
snippet is genuinely-read content from the parent `source_documents` row, which
is what mints that parent an anchor and makes it citable provenance in the
bundle. An empty snippet evidences nothing, so the row cannot support a
citation, so the record is not admissible.

These tests bind `_admissible_context_snippet` — the single decision point both
declare sites route through. They deliberately do NOT reach into flow.py's
declare loops: the loops' job is to honour the verdict, and a test that
reimplemented their control flow would assert the shape of the code rather than
the behaviour of the rule.

See also `test_mock_llm.py`, which covers the other half of the same ruling —
the mock's per-document canary had to become anchored, because a synthesised
one now produces no row at all.
"""

from __future__ import annotations

import json
import logging
import uuid

import pytest

from scripts.cocoindex_pipeline.flow import _admissible_context_snippet

_DOC = (
    "# Capability statement — Calderwood Facilities Group Ltd\n"
    "\n"
    "Calderwood Facilities Group Ltd maintains a certified management system "
    "and reports against agreed key performance indicators every month.\n"
)
_SD_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_OP_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")


def _call(entity_name: str, span_start: int | None, span_end: int | None):
    return _admissible_context_snippet(
        content_text=_DOC,
        entity_name=entity_name,
        span_start=span_start,
        span_end=span_end,
        source_document_id=_SD_ID,
        rel_path="content/synthetic-capability-statement.md",
        op_id=_OP_ID,
    )


class TestAdmitted:
    def test_a_name_the_document_contains_is_admitted_with_its_context(self) -> None:
        name = "Calderwood Facilities Group Ltd"
        snippet = _call(name, _DOC.index(name), _DOC.index(name) + len(name))
        assert snippet is not None
        assert name.lower() in snippet.lower()

    def test_a_name_present_but_with_no_span_still_resolves_by_search(self) -> None:
        """A missing span is not a missing anchor.

        Some extractors supply no offsets at all. The name still occurs in the
        text, so the document does support the claim and the row is admissible —
        the search path is the fallback, not a degraded mode.
        """
        snippet = _call("Calderwood Facilities Group Ltd", None, None)
        assert snippet is not None
        assert snippet.strip() != ""


class TestRefused:
    def test_a_synthesised_name_is_refused(self) -> None:
        """The exact shape the old mock canary emitted.

        `MOCK Org <hash>` with span (0, len(name)): in-bounds, pointing at the
        document's opening characters, and describing nothing. Trusting the
        bounds alone would yield a confident lie — a snippet of the heading,
        attributed to an entity that is not there.
        """
        name = "MOCK Org 0aaac9d6d05f"
        assert _call(name, 0, len(name)) is None

    def test_a_normalised_name_the_document_never_says_is_refused(self) -> None:
        """The realistic production case, not just the mock's.

        An extractor may return "Calderwood Ltd" for a document that only ever
        writes "Calderwood Facilities Group Ltd". That is a reasonable
        normalisation and still a claim the document does not make, so it
        carries no evidence and is refused for the same reason.
        """
        assert _call("Calderwood Ltd", None, None) is None

    def test_an_out_of_bounds_span_does_not_rescue_an_absent_name(self) -> None:
        assert _call("Nowhere Holdings Plc", 10_000, 10_020) is None


class TestTheRefusalIsNeverSilent:
    """id-414's rule: a contained fault that nothing reports is the defect.

    The whole point of the S522 finding was a run that dropped 159 items and
    reported `completed`. A refusal that left no trace would be the same
    mistake at row granularity.
    """

    def test_a_refusal_logs_a_structured_line_naming_the_entity(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.WARNING, logger="scripts.cocoindex_pipeline.flow"):
            assert _call("MOCK Org deadbeef1234", 0, 21) is None

        events = [
            json.loads(r.message)
            for r in caplog.records
            if r.message.lstrip().startswith("{")
        ]
        refusals = [
            e
            for e in events
            if e.get("event") == "cocoindex.entity_mention.unanchored_refused"
        ]
        assert len(refusals) == 1

        refusal = refusals[0]
        # Enough to find the row's document and run without re-deriving them.
        assert refusal["entity_name"] == "MOCK Org deadbeef1234"
        assert refusal["source_document_id"] == str(_SD_ID)
        assert refusal["op_id"] == str(_OP_ID)
        assert refusal["rel_path"].endswith(".md")
        assert "context_snippet" in refusal["reason"]

    def test_an_admitted_mention_logs_nothing(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.WARNING, logger="scripts.cocoindex_pipeline.flow"):
            assert _call("Calderwood Facilities Group Ltd", None, None) is not None
        assert not [
            r
            for r in caplog.records
            if "unanchored_refused" in r.message
        ]
