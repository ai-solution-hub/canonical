from __future__ import annotations

from datetime import date

from pipeline.produce.index import IndexEntry, render_root_index, render_type_index, seed_log_if_absent


def test_render_root_index_heading_is_always_subdirectories():
    text = render_root_index(
        [IndexEntry(title="topics", rel_link="topics/index.md", description="4 topic concepts.")]
    )
    assert text.startswith("# Subdirectories\n\n")
    assert "* [topics](topics/index.md) - 4 topic concepts." in text


def test_render_root_index_empty_subdirs_still_has_heading():
    text = render_root_index([])
    assert text.startswith("# Subdirectories\n")
    assert "*" not in text


def test_render_type_index_heading_is_type_label_no_concepts_subheading():
    text = render_type_index(
        "Topic",
        [
            IndexEntry(title="Data Protection", rel_link="data-protection.md", description="d1"),
            IndexEntry(title="Quality Management", rel_link="quality-management.md", description="d2"),
        ],
    )
    assert text.startswith("# Topic\n\n")
    assert "Concepts" not in text
    assert "* [Data Protection](data-protection.md) - d1" in text
    assert "* [Quality Management](quality-management.md) - d2" in text


def test_render_type_index_entries_sorted_case_insensitively():
    text = render_type_index(
        "Topic",
        [
            IndexEntry(title="zzz", rel_link="z.md"),
            IndexEntry(title="Aaa", rel_link="a.md"),
        ],
    )
    lines = [l for l in text.splitlines() if l.startswith("* ")]
    assert lines[0].startswith("* [Aaa]")
    assert lines[1].startswith("* [zzz]")


def test_seed_log_if_absent_seeds_once():
    seeded = seed_log_if_absent(None, bundle_title="Canonical corpus bundle", today=date(2026, 8, 14))
    text = seeded.decode("utf-8")
    assert text.startswith("---\ntype: Log\n")
    assert "## 2026-08-14" in text
    assert "process:pipeline-produce" in text


def test_seed_log_if_absent_never_touches_existing_content():
    existing = b"---\ntype: Log\ntitle: Hand-edited\n---\n\n# Bundle history\n\n## 2020-01-01\n\n- **Hand note.**\n"
    result = seed_log_if_absent(existing, bundle_title="Canonical corpus bundle", today=date(2026, 8, 14))
    assert result == existing
