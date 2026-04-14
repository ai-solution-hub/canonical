/**
 * Editor save-safety guard — WP1 fix S169.
 *
 * Defence-in-depth against silent data loss when persisting edits from the
 * Tiptap-based `ContentEditor`. The guard compares the length of the
 * canonical markdown the user is about to save against the length of the
 * last-persisted canonical markdown. If the new value drops below
 * `minRatio × baseline` (default 20% loss), we block the save.
 *
 * Original motivating incident (pre-S169): GFM tables were silently dropped
 * on save because the Tiptap schema had no table nodes. The fix registers
 * the table extensions; this guard is the defence-in-depth that would have
 * caught the issue even without the schema fix.
 *
 * CRITICAL: both the baseline and the new length MUST be measured in the
 * same units — canonical markdown length. Mixing markdown length with
 * Tiptap JSON length (or any other serialisation) invalidates the ratio.
 *
 * Known exception (deliberately not handled): first-save. When the baseline
 * length is 0 (brand-new item with no previously persisted content), any
 * save is permitted regardless of new length. This is by design — there is
 * nothing to protect against on an empty baseline. Callers that want to
 * enforce a non-zero minimum must add their own validation.
 */

/**
 * Default minimum ratio. If the new markdown is shorter than
 * `SAVE_SAFETY_MIN_RATIO × baseline`, the save is blocked. 0.8 = 20% loss.
 */
export const SAVE_SAFETY_MIN_RATIO = 0.8;

/**
 * Pure predicate. Returns `true` when the save should be blocked, `false`
 * otherwise. `baselineLength <= 0` always returns `false` (first-save).
 *
 * @param baselineLength  Length of the last-persisted canonical markdown.
 * @param newLength       Length of the markdown the user is about to save.
 * @param minRatio        Threshold; defaults to {@link SAVE_SAFETY_MIN_RATIO}.
 */
export function shouldBlockSave(
  baselineLength: number,
  newLength: number,
  minRatio: number = SAVE_SAFETY_MIN_RATIO,
): boolean {
  if (baselineLength <= 0) return false;
  return newLength < baselineLength * minRatio;
}

/**
 * Canonical error-toast copy surfaced when the guard fires. UK English.
 *
 * Critically does NOT tell the user to refresh — refreshing destroys their
 * unsaved edits, which is exactly what the guard is trying to protect.
 */
export const SAVE_SAFETY_BLOCK_MESSAGE =
  "Save blocked — content length dropped unexpectedly. Don't refresh; copy your edits somewhere safe, then contact support.";
