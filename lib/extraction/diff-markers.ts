/**
 * Detect git-style merge-conflict markers and patch-diff `+`/`-` lines in a
 * markdown document.
 *
 * Counts:
 *   - `gitConflictCount`: lines starting with `<<<<<<<`, `=======`, or
 *     `>>>>>>>` outside fenced code blocks (` ``` ` or `~~~`).
 *   - `plusMinusLineCount`: lines starting with `+` or `-` (not bare,
 *     trailing-whitespace-only) outside fenced code blocks. Used to flag
 *     pasted patch text inside narrative content.
 *
 * Used as a best-effort, warn-only pre-flight check during EP2 markdown
 * ingest — does not block import.
 */

export interface DiffMarkerScan {
  gitConflictCount: number;
  plusMinusLineCount: number;
  warning: boolean;
}

const CONFLICT_LINE_RE = /^(?:<{7}|={7}|>{7})(?:\s|$)/;
const PLUS_MINUS_LINE_RE = /^[+\-](?!\s*$)/;
const FENCE_RE = /^(?:```|~~~)/;

export function detectDiffMarkers(input: string): DiffMarkerScan {
  const lines = input.split(/\r?\n/);
  let inFence = false;
  let gitConflictCount = 0;
  let plusMinusLineCount = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) continue;

    if (CONFLICT_LINE_RE.test(trimmed)) {
      gitConflictCount++;
    } else if (PLUS_MINUS_LINE_RE.test(trimmed)) {
      plusMinusLineCount++;
    }
  }

  return {
    gitConflictCount,
    plusMinusLineCount,
    warning: gitConflictCount > 0 || plusMinusLineCount > 0,
  };
}
