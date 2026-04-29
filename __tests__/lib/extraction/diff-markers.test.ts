import { describe, it, expect } from 'vitest';
import { detectDiffMarkers } from '@/lib/extraction/diff-markers';

describe('detectDiffMarkers', () => {
  it('reports no warnings for a clean markdown file', () => {
    const input = `# Hello

Just a normal markdown file with no conflict markers.

## Section

Body text.`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(false);
    expect(result.gitConflictCount).toBe(0);
    expect(result.plusMinusLineCount).toBe(0);
  });

  it('detects a single unresolved conflict block (3 markers)', () => {
    const input = `# Doc

<<<<<<< HEAD
This is the local change.
=======
This is the incoming change.
>>>>>>> feature/branch

Tail.`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(true);
    expect(result.gitConflictCount).toBe(3);
  });

  it('detects multiple conflict blocks and counts every marker line', () => {
    const input = `<<<<<<< HEAD
a
=======
b
>>>>>>> branch1

other content

<<<<<<< HEAD
c
=======
d
>>>>>>> branch2`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(true);
    expect(result.gitConflictCount).toBe(6);
  });

  it('ignores marker-like text inside fenced code blocks', () => {
    const input = `# Tutorial

Show how a conflict looks:

\`\`\`
<<<<<<< HEAD
local
=======
remote
>>>>>>> branch
\`\`\`

The end.`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(false);
    expect(result.gitConflictCount).toBe(0);
    expect(result.plusMinusLineCount).toBe(0);
  });

  it('ignores marker-like text inside tilde-fenced code blocks', () => {
    const input = `~~~
<<<<<<< HEAD
=======
>>>>>>> upstream
~~~

regular body`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(false);
    expect(result.gitConflictCount).toBe(0);
  });

  it('counts markers outside a code block but ignores those inside in the same file', () => {
    const input = `<<<<<<< HEAD
real conflict
=======
real other
>>>>>>> b

\`\`\`
<<<<<<< HEAD
inside the fence — ignored
\`\`\``;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(true);
    expect(result.gitConflictCount).toBe(3);
  });

  it('counts +/- patch lines outside fenced blocks', () => {
    const input = `# Patch notes

The team applied this diff inline:

+ added a new field
- removed an old one
+ another addition

End of doc.`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(true);
    expect(result.gitConflictCount).toBe(0);
    expect(result.plusMinusLineCount).toBe(3);
  });

  it('ignores +/- patch-like lines inside fenced code blocks', () => {
    const input = `# Diff demo

\`\`\`diff
+ this is intentional sample patch text
- this too
\`\`\`

Normal body.`;

    const result = detectDiffMarkers(input);

    expect(result.warning).toBe(false);
    expect(result.plusMinusLineCount).toBe(0);
  });
});
