/**
 * Detect git-style merge-conflict markers in a markdown document.
 *
 * Counts lines starting with `<<<<<<<`, `=======`, or `>>>>>>>` outside
 * fenced code blocks (` ``` ` or `~~~`). Used as a best-effort, warn-only
 * pre-flight check during EP2 markdown ingest — does not block import.
 */

export interface DiffMarkerScan {
  hasMarkers: boolean;
  markerCount: number;
}

const CONFLICT_LINE_RE = /^(?:<{7}|={7}|>{7})(?:\s|$)/;
const FENCE_RE = /^(?:```|~~~)/;

export function detectDiffMarkers(input: string): DiffMarkerScan {
  const lines = input.split(/\r?\n/);
  let inFence = false;
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (FENCE_RE.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) continue;

    if (CONFLICT_LINE_RE.test(trimmed)) {
      count++;
    }
  }

  return { hasMarkers: count > 0, markerCount: count };
}
