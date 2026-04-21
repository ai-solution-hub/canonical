"""Title-normalisation for cross-source duplicate detection (S183 WP2).

Mirror of `lib/dedup-normalise.ts` — keep the algorithms in sync.

Used by the dedup gate when we need to detect near-identical titles
that differ only in articles, casing, or trailing punctuation.
Motivating example: "Are access levels granted according to the
principle of least privilege?" vs "...according to principle of
least privilege?" collided on import but content_text_hash missed
them because the answer bodies differed slightly.
"""

import re

# Word-boundary articles — matches "the", "a", "an" as standalone words
# so "according to the principle" and "according to principle" collapse
# to the same form. Reference S183 acceptance in the continuation prompt
# ("Are access levels granted according to [the] principle..." should
# dedup with the "the"-less variant).
_STANDALONE_ARTICLES = re.compile(r"\b(?:the|a|an)\b", re.IGNORECASE)
_TRAILING_PUNCTUATION = re.compile(r"[?.!,;:\s]+$")
_INTERNAL_WHITESPACE = re.compile(r"\s+")


def normalise_title_for_dedup(title: str) -> str:
    """Normalise a title for dedup comparison.

    Steps:
      1. Lowercase
      2. Remove standalone articles ("the", "a", "an") anywhere in the text
      3. Collapse whitespace to single spaces
      4. Strip trailing punctuation (?, ., !, ,, ;, :) and whitespace

    Trade-off: removing mid-sentence articles accepts a small
    false-positive risk (e.g. "going to a shop" vs "going to shop")
    for the benefit of catching the S182-surfaced regression pair.
    The alternative — leading articles only — fails to catch
    cross-file Q&A title variants that were the original motivation.

    Returns an empty string if the input is empty or only punctuation.
    """
    if not title:
        return ""
    out = title.lower()
    out = _STANDALONE_ARTICLES.sub(" ", out)
    out = _INTERNAL_WHITESPACE.sub(" ", out)
    out = _TRAILING_PUNCTUATION.sub("", out)
    return out.strip()
