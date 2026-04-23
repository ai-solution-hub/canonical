"""Tests for resolve_question_for_rebuild — mirrors the 5 TS test cases."""

from kb_pipeline.resolve_question import resolve_question_for_rebuild


class TestResolveQuestionForRebuild:
    """Five cases per spec ss14 item 5."""

    def test_extracts_full_question_from_content_with_q_prefix(self):
        content = "Q: full question\n\nanswer"
        title = "truncated title"
        assert resolve_question_for_rebuild(content, title) == "full question"

    def test_falls_back_to_title_when_content_lacks_q_prefix(self):
        content = "plain answer without Q: prefix"
        title = "truncd q"
        assert resolve_question_for_rebuild(content, title) == "truncd q"

    def test_falls_back_to_title_when_content_is_none(self):
        title = "truncd q"
        assert resolve_question_for_rebuild(None, title) == "truncd q"

    def test_extracts_question_from_content_when_title_is_none(self):
        content = "Q: a"
        assert resolve_question_for_rebuild(content, None) == "a"

    def test_returns_empty_string_when_both_none(self):
        assert resolve_question_for_rebuild(None, None) == ""
