"""LLM extraction — LiteLLM + instructor, memoized (DESIGN.md §2 Phase A).

Per-chunk structured extraction of staged Q&A pairs and raw entity/
relationship candidates, plus the DR-135 mention-anchoring check that
decides whether a candidate may ever become a written row: a mention whose
surface form does not occur in the document's own text is refused, never
written with a fabricated or empty snippet (DESIGN.md §2 Phase C).

No mock LLM server, no fault injector (DR-152) — testing is recorded
fixtures + real-tier smokes, per DESIGN.md §5.
"""

from __future__ import annotations

from typing import Literal, cast

import cocoindex as coco
import instructor
import litellm
import pydantic

litellm.drop_params = True

# Mirrors the `entity_mentions.entity_type` / `entity_relationships.
# relationship_type` CHECK constraints (verified against the live schema,
# `public.entity_mentions`/`public.entity_relationships`) — an out-of-taxonomy
# value fails validation client-side (instructor retries) rather than a DB
# CHECK violation surfacing mid-run.
EntityType = Literal[
    "organisation",
    "certification",
    "regulation",
    "framework",
    "capability",
    "person",
    "technology",
    "project",
    "sector",
    "product",
    "standard",
    "methodology",
]

RelationshipType = Literal[
    "holds",
    "complies_with",
    "delivers_to",
    "uses",
    "demonstrated_by",
    "requires",
    "part_of",
    "supersedes",
    "references",
    "evidences",
]


# ---------------------------------------------------------------------------
# LLM extraction schemas (Pydantic, for instructor)
# ---------------------------------------------------------------------------


class ExtractedEntity(pydantic.BaseModel):
    name: str = pydantic.Field(
        description="The entity's name exactly as it appears in the text."
    )
    entity_type: EntityType = pydantic.Field(description="The entity's type.")


class ExtractedRelationship(pydantic.BaseModel):
    source: ExtractedEntity = pydantic.Field(description="The relationship's subject.")
    relationship_type: RelationshipType
    target: ExtractedEntity = pydantic.Field(description="The relationship's object.")


class ExtractedQAPair(pydantic.BaseModel):
    question: str = pydantic.Field(
        description="A question this text answers, phrased standalone."
    )
    answer: str | None = pydantic.Field(
        default=None,
        description=(
            "The answer, drawn from the text. Null if the text poses a "
            "question it does not itself answer."
        ),
    )


class ExtractedChunk(pydantic.BaseModel):
    qa_pairs: list[ExtractedQAPair] = pydantic.Field(default_factory=list)
    entities: list[ExtractedEntity] = pydantic.Field(default_factory=list)
    relationships: list[ExtractedRelationship] = pydantic.Field(default_factory=list)


EXTRACT_PROMPT = """\
You are an expert at reading knowledge-base documents and extracting \
structured information from one chunk of a larger document.

Given a chunk of Markdown text, extract:
- Q&A pairs: standalone questions the chunk answers, paired with the answer \
drawn from the text. Only include a pair when the chunk itself states the \
answer — leave `answer` null rather than inventing one.
- Entities: named organisations, people, technologies, standards, projects, \
and similar concrete things mentioned in the chunk, each with its type.
- Relationships: factual relationships BETWEEN two extracted entities (e.g. \
an organisation holds a certification, a project uses a technology).

Use each entity's name exactly as it is written in the text — do not \
normalise, translate, or expand it. Return only what the text supports.
"""


@coco.fn(memo=True)
async def extract_chunk(chunk_text: str, model: str) -> ExtractedChunk:
    """Extract structured Q&A/entity/relationship candidates from one chunk."""
    # MD_JSON, not JSON: Anthropic models routinely wrap structured output
    # in ```json fences, which Mode.JSON refuses verbatim — found on the
    # first real-tier run (S565, claude-haiku-4-5). MD_JSON both requests
    # and parses the fenced form, provider-neutrally.
    client = cast(
        instructor.AsyncInstructor,
        instructor.from_litellm(litellm.acompletion, mode=instructor.Mode.MD_JSON),
    )
    result = await client.chat.completions.create(
        model=model,
        response_model=ExtractedChunk,
        messages=[
            {"role": "system", "content": EXTRACT_PROMPT},
            {"role": "user", "content": chunk_text},
        ],
    )
    # Re-validate to restore class identity for pickling (memoized results
    # cross a process boundary), mirroring the style-baseline idiom.
    return ExtractedChunk.model_validate(result.model_dump())


# ---------------------------------------------------------------------------
# DR-135 — mention anchoring
# ---------------------------------------------------------------------------

_CONTEXT_RADIUS = 80


def entity_context_or_none(document_text: str, entity_name: str) -> str | None:
    """The mention's context snippet, or `None` when the mention is unanchored.

    `None` means REFUSE THE ROW (DR-135; DESIGN.md §2 Phase C): a candidate
    whose surface form does not occur — case-insensitively — anywhere in the
    document's own text carries no evidence the document was actually read,
    so it is not written, not written with an empty/placeholder snippet.

    Case-insensitive substring search only (no extractor-supplied span, since
    this extraction schema does not ask for one) — sufficient to satisfy the
    refuse-unanchored gate; it does not attempt to disambiguate which of
    several textual occurrences the extractor meant.
    """
    if not document_text or not entity_name:
        return None
    lower_text = document_text.lower()
    lower_entity = entity_name.lower()
    idx = lower_text.find(lower_entity)
    if idx == -1:
        return None
    lo = max(0, idx - _CONTEXT_RADIUS)
    hi = min(len(document_text), idx + len(entity_name) + _CONTEXT_RADIUS)
    snippet = document_text[lo:hi].strip()
    if lo > 0:
        snippet = f"...{snippet}"
    if hi < len(document_text):
        snippet = f"{snippet}..."
    return snippet
