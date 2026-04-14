/**
 * Heading-based content chunking.
 *
 * Splits a markdown document at heading boundaries so that content_items
 * stored in the knowledge base can be retrieved section-by-section by MCP
 * agents instead of as whole documents.
 *
 * Algorithm:
 *   - Default split level: H2
 *   - Fallback: H1 if no H2 exists
 *   - Documents with no headings (or only H3+) => single chunk
 *   - Documents < MIN_DOCUMENT_CHARS => single chunk (not worth splitting)
 *   - Chunks < MIN_CHUNK_CHARS merge with the next sibling (or the previous
 *     chunk if they are the last one)
 *
 * Code blocks are safe: `# comment` inside a fenced code block is tokenised
 * as part of `{type: 'code'}`, not `{type: 'heading'}` -- the marked lexer
 * handles this correctly.
 */

import { marked, type Token, type Tokens } from 'marked';

export interface ContentChunk {
  heading_text: string | null;
  heading_level: number | null;
  heading_path: string[];
  content: string;
  position: number;
  parent_position: number | null;
  char_count: number;
  word_count: number;
}

/** Minimum character count for a chunk. Shorter chunks merge with next sibling. */
export const MIN_CHUNK_CHARS = 100;

/** Documents shorter than this are not chunked (single chunk). */
export const MIN_DOCUMENT_CHARS = 500;

/**
 * Determine the split level for a document.
 * Default: H2. Fallback: H1 if no H2 exists. No split for headingless docs.
 */
function determineSplitLevel(tokens: Token[]): number | null {
  const headingDepths = tokens
    .filter((t): t is Tokens.Heading => t.type === 'heading')
    .map((t) => t.depth);

  if (headingDepths.length === 0) return null; // no headings at all
  if (headingDepths.includes(2)) return 2; // H2 exists -> split at H2
  if (headingDepths.includes(1)) return 1; // only H1 -> split at H1
  return null; // only H3+ -> no split
}

/**
 * Find the parent position for a heading based on the heading stack.
 * Parent is the last heading in the stack with a lower depth.
 */
function findParentPosition(
  headingStack: { level: number; text: string; position: number }[],
  currentHeading: { level: number; text: string } | null,
): number | null {
  if (!currentHeading || headingStack.length === 0) return null;
  // Walk stack backwards to find first heading with lower depth
  for (let i = headingStack.length - 1; i >= 0; i--) {
    if (headingStack[i].level < currentHeading.level) {
      return headingStack[i].position;
    }
  }
  return null;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function singleChunk(content: string): ContentChunk {
  return {
    heading_text: null,
    heading_level: null,
    heading_path: [],
    content,
    position: 0,
    parent_position: null,
    char_count: content.length,
    word_count: countWords(content),
  };
}

/**
 * Split markdown content into chunks at heading boundaries.
 *
 * Split level: H2 by default. Falls back to H1 if no H2 exists.
 * Documents with no headings or < MIN_DOCUMENT_CHARS become a single chunk.
 * Chunks < MIN_CHUNK_CHARS are merged with the next sibling.
 */
export function chunkByHeadings(markdown: string): ContentChunk[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];

  // Short documents: single chunk, no splitting
  if (trimmed.length < MIN_DOCUMENT_CHARS) {
    return [singleChunk(trimmed)];
  }

  const tokens = marked.lexer(trimmed);
  const splitLevel = determineSplitLevel(tokens);

  // No splittable headings: single chunk
  if (splitLevel === null) {
    return [singleChunk(trimmed)];
  }

  // Build raw chunks by splitting at the determined heading level
  const rawChunks: ContentChunk[] = [];
  const headingStack: { level: number; text: string; position: number }[] = [];
  let currentTokens: Token[] = [];
  let currentHeading: { level: number; text: string } | null = null;

  function flushChunk() {
    if (currentTokens.length === 0) return;
    const content = currentTokens
      .map((t) => t.raw)
      .join('')
      .trim();
    if (!content) return;

    const path = headingStack.map((h) => h.text);

    rawChunks.push({
      heading_text: currentHeading?.text ?? null,
      heading_level: currentHeading?.level ?? null,
      heading_path: [...path],
      content,
      position: rawChunks.length,
      parent_position: findParentPosition(headingStack, currentHeading),
      char_count: content.length,
      word_count: countWords(content),
    });
  }

  for (const token of tokens) {
    if (token.type === 'heading' && token.depth <= splitLevel) {
      flushChunk();

      // Update heading stack: pop anything at same or deeper level
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= token.depth
      ) {
        headingStack.pop();
      }
      headingStack.push({
        level: token.depth,
        text: token.text,
        position: rawChunks.length,
      });

      currentHeading = { level: token.depth, text: token.text };
      currentTokens = [token];
    } else {
      currentTokens.push(token);
    }
  }
  flushChunk();

  // Handle edge case: no chunks produced (shouldn't happen if splitLevel was found)
  if (rawChunks.length === 0) {
    return [singleChunk(trimmed)];
  }

  // Merge small chunks (< MIN_CHUNK_CHARS) with the next sibling
  const merged: ContentChunk[] = [];
  let pendingMerge: ContentChunk | null = null;

  for (const chunk of rawChunks) {
    if (pendingMerge) {
      // Merge pending into this chunk
      const combinedContent = pendingMerge.content + '\n\n' + chunk.content;
      merged.push({
        ...chunk,
        heading_text: pendingMerge.heading_text ?? chunk.heading_text,
        heading_level: pendingMerge.heading_level ?? chunk.heading_level,
        heading_path:
          pendingMerge.heading_path.length > 0
            ? pendingMerge.heading_path
            : chunk.heading_path,
        content: combinedContent,
        position: merged.length,
        parent_position: chunk.parent_position,
        char_count: combinedContent.length,
        word_count: countWords(combinedContent),
      });
      pendingMerge = null;
    } else if (chunk.char_count < MIN_CHUNK_CHARS) {
      pendingMerge = chunk;
    } else {
      merged.push({ ...chunk, position: merged.length });
    }
  }

  // If the last chunk was too small and still pending, merge with the previous
  if (pendingMerge) {
    if (merged.length > 0) {
      const last = merged[merged.length - 1];
      const combinedContent = last.content + '\n\n' + pendingMerge.content;
      merged[merged.length - 1] = {
        ...last,
        content: combinedContent,
        char_count: combinedContent.length,
        word_count: countWords(combinedContent),
      };
    } else {
      merged.push({ ...pendingMerge, position: 0 });
    }
  }

  return merged;
}
