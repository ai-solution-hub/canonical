/**
 * Escape PostgREST metacharacters in user-supplied values before
 * interpolating them into `.or()` / `.ilike()` filter strings.
 *
 * Characters escaped: % _ * ( ) , . \
 *
 * Without this, a malicious or accidental search term like
 * `%,title.eq.admin)` could break out of the intended filter clause.
 */
export function escapePostgrestValue(input: string): string {
  return input.replace(/[%_*(),.\\]/g, (ch) => `\\${ch}`);
}

/**
 * Escape a value for interpolation inside a PostgREST double-quoted operand,
 * e.g. `.or('source_entity.eq."<value>"')`. Builds on escapePostgrestValue
 * and additionally escapes the double-quote that delimits the operand.
 *
 * Do NOT add a second backslash pass: escapePostgrestValue already escapes
 * backslashes, and PostgREST strips one backslash level when parsing a quoted
 * operand. Double-escaping makes PostgREST match a literal backslash and
 * silently returns zero rows for any value containing a metacharacter
 * (e.g. "Acme Ltd.", "A.B"). A CodeQL autofix introduced exactly this bug.
 */
export function escapePostgrestQuotedValue(input: string): string {
  return escapePostgrestValue(input).replace(/"/g, '\\"');
}
