"""Content chunking via markdown heading detection.

Splits markdown content at H2 (or H1 fallback) heading boundaries.
Mirrors the TypeScript implementation in lib/content/chunking.ts.
Uses a regex-based approach (not a full markdown parser) since Python
does not have `marked` -- but handles code blocks correctly.
"""

import json
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

from .embed import generate_embedding
from .store import _request

logger = logging.getLogger(__name__)

MIN_CHUNK_CHARS = 100
MIN_DOCUMENT_CHARS = 500
MAX_EMBEDDING_CHARS = 24000

# Regex to detect markdown headings, but NOT inside code blocks.
# We pre-strip code blocks before scanning for headings.
CODE_BLOCK_RE = re.compile(r'```[\s\S]*?```', re.MULTILINE)
HEADING_RE = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)


@dataclass
class ContentChunk:
    heading_text: Optional[str]
    heading_level: Optional[int]
    heading_path: List[str]
    content: str
    position: int
    parent_position: Optional[int]
    char_count: int
    word_count: int


def _determine_split_level(markdown: str) -> Optional[int]:
    """Determine split level: H2 if present, H1 fallback, None if no headings."""
    # Strip code blocks to avoid false heading detection
    stripped = CODE_BLOCK_RE.sub('', markdown)
    levels = set()
    for match in HEADING_RE.finditer(stripped):
        levels.add(len(match.group(1)))
    if 2 in levels:
        return 2
    if 1 in levels:
        return 1
    return None


def chunk_by_headings(markdown: str) -> List[ContentChunk]:
    """Split markdown at heading boundaries. Mirrors TS chunkByHeadings()."""
    trimmed = (markdown or '').strip()
    if not trimmed:
        return []

    if len(trimmed) < MIN_DOCUMENT_CHARS:
        words = len(trimmed.split())
        return [ContentChunk(
            heading_text=None, heading_level=None, heading_path=[],
            content=trimmed, position=0, parent_position=None,
            char_count=len(trimmed), word_count=words,
        )]

    split_level = _determine_split_level(trimmed)
    if split_level is None:
        words = len(trimmed.split())
        return [ContentChunk(
            heading_text=None, heading_level=None, heading_path=[],
            content=trimmed, position=0, parent_position=None,
            char_count=len(trimmed), word_count=words,
        )]

    # Line-based splitting that respects code blocks
    lines = trimmed.split('\n')
    raw_chunks: List[ContentChunk] = []
    heading_stack: List[dict] = []
    current_lines: List[str] = []
    current_heading: Optional[dict] = None
    in_code_block = False

    def flush():
        nonlocal current_lines, current_heading
        content = '\n'.join(current_lines).strip()
        if not content:
            return
        path = [h['text'] for h in heading_stack]
        parent_pos = None
        if current_heading and heading_stack:
            for h in reversed(heading_stack):
                if h['level'] < current_heading['level']:
                    parent_pos = h['position']
                    break
        words = len(content.split())
        raw_chunks.append(ContentChunk(
            heading_text=current_heading['text'] if current_heading else None,
            heading_level=current_heading['level'] if current_heading else None,
            heading_path=list(path),
            content=content,
            position=len(raw_chunks),
            parent_position=parent_pos,
            char_count=len(content),
            word_count=words,
        ))

    for line in lines:
        stripped_line = line.strip()
        # Track code block boundaries
        if stripped_line.startswith('```'):
            in_code_block = not in_code_block
            current_lines.append(line)
            continue

        if in_code_block:
            current_lines.append(line)
            continue

        # Check for heading at or above split level
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', stripped_line)
        if heading_match and len(heading_match.group(1)) <= split_level:
            flush()
            level = len(heading_match.group(1))
            text = heading_match.group(2).strip()
            while heading_stack and heading_stack[-1]['level'] >= level:
                heading_stack.pop()
            heading_stack.append({
                'level': level, 'text': text, 'position': len(raw_chunks),
            })
            current_heading = {'level': level, 'text': text}
            current_lines = [line]
        else:
            current_lines.append(line)

    flush()

    if not raw_chunks:
        words = len(trimmed.split())
        return [ContentChunk(
            heading_text=None, heading_level=None, heading_path=[],
            content=trimmed, position=0, parent_position=None,
            char_count=len(trimmed), word_count=words,
        )]

    # Merge small chunks with next sibling
    merged: List[ContentChunk] = []
    pending: Optional[ContentChunk] = None
    for chunk in raw_chunks:
        if pending:
            combined = pending.content + '\n\n' + chunk.content
            merged.append(ContentChunk(
                heading_text=pending.heading_text or chunk.heading_text,
                heading_level=pending.heading_level or chunk.heading_level,
                heading_path=pending.heading_path if pending.heading_path else chunk.heading_path,
                content=combined,
                position=len(merged),
                parent_position=chunk.parent_position,
                char_count=len(combined),
                word_count=len(combined.split()),
            ))
            pending = None
        elif chunk.char_count < MIN_CHUNK_CHARS:
            pending = chunk
        else:
            merged.append(ContentChunk(
                heading_text=chunk.heading_text,
                heading_level=chunk.heading_level,
                heading_path=list(chunk.heading_path),
                content=chunk.content,
                position=len(merged),
                parent_position=chunk.parent_position,
                char_count=chunk.char_count,
                word_count=chunk.word_count,
            ))

    if pending:
        if merged:
            last = merged[-1]
            combined = last.content + '\n\n' + pending.content
            merged[-1] = ContentChunk(
                heading_text=last.heading_text,
                heading_level=last.heading_level,
                heading_path=list(last.heading_path),
                content=combined,
                position=last.position,
                parent_position=last.parent_position,
                char_count=len(combined),
                word_count=len(combined.split()),
            )
        else:
            merged.append(ContentChunk(
                heading_text=pending.heading_text,
                heading_level=pending.heading_level,
                heading_path=list(pending.heading_path),
                content=pending.content,
                position=0,
                parent_position=pending.parent_position,
                char_count=pending.char_count,
                word_count=pending.word_count,
            ))

    return merged


def _delete_existing_chunks(item_id: str) -> None:
    """Remove any existing chunks for this content item (idempotent regen)."""
    path = f"content_chunks?content_item_id=eq.{item_id}"
    _request("DELETE", path, prefer="return=minimal")


def store_chunks(item_id: str, markdown: str) -> tuple[int, List[str]]:
    """Generate chunks, embed them, and store in content_chunks table.

    Returns (stored_count, errors).
    """
    errors: List[str] = []
    chunks = chunk_by_headings(markdown)

    if not chunks:
        return 0, []

    # Idempotent: delete existing chunks first
    try:
        _delete_existing_chunks(item_id)
    except Exception as e:
        errors.append(f"Failed to clear existing chunks: {e}")

    # Generate embeddings for each chunk
    chunk_rows = []
    for chunk in chunks:
        prefix = ' > '.join(chunk.heading_path) + '\n\n' if chunk.heading_path else ''
        embed_text = prefix + chunk.content
        embed_text = embed_text[:MAX_EMBEDDING_CHARS]

        embedding: Optional[List[float]] = None
        try:
            embedding, _tokens = generate_embedding(embed_text)
        except Exception as e:
            errors.append(f"Chunk {chunk.position} embedding failed: {e}")

        chunk_rows.append({
            'content_item_id': item_id,
            'heading_text': chunk.heading_text,
            'heading_level': chunk.heading_level,
            'heading_path': chunk.heading_path,
            'content': chunk.content,
            'position': chunk.position,
            'parent_chunk_id': None,
            'embedding': json.dumps(embedding) if embedding else None,
            'char_count': chunk.char_count,
            'word_count': chunk.word_count,
        })

    # Insert all chunks
    status, response = _request("POST", "content_chunks", chunk_rows)
    if status not in (200, 201) or not isinstance(response, list) or not response:
        errors.append(f"Chunk insert failed: status={status} body={response}")
        return 0, errors

    # Build position -> UUID map for parent resolution
    pos_to_id = {row['position']: row['id'] for row in response}

    # Update parent references
    for chunk in chunks:
        if chunk.parent_position is not None:
            chunk_id = pos_to_id.get(chunk.position)
            parent_id = pos_to_id.get(chunk.parent_position)
            if chunk_id and parent_id:
                update_path = f"content_chunks?id=eq.{chunk_id}"
                up_status, _ = _request(
                    "PATCH",
                    update_path,
                    {'parent_chunk_id': parent_id},
                    prefer="return=minimal",
                )
                if up_status not in (200, 204):
                    errors.append(
                        f"Parent update for chunk {chunk.position}: status {up_status}"
                    )

    return len(response), errors
