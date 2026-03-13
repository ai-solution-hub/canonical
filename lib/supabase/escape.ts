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
