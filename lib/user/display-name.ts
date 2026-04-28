/**
 * Resolve a single first-person display name from a Supabase auth user.
 *
 * Used by `lib/dashboard.ts` and `lib/reorient.ts` to render the
 * personal greeting on the dashboard ("Welcome back, Liam"). The
 * fallback chain is:
 *
 *   1. `user_metadata.display_name` (the field the Settings page writes)
 *   2. `user_metadata.full_name` (some OAuth providers populate this)
 *   3. Email-prefix derivation (strip dots/underscores and trailing
 *      digits, then title-case)
 *   4. `null` if the email is missing or the prefix cleans to nothing
 *
 * Multi-word raw display names are reduced to the first token so the
 * greeting reads "Welcome back, Liam" rather than "Welcome back, Liam
 * Jones".
 *
 * Companion to `lib/users/display-names.ts`, which is the **batch**
 * resolver for OTHER users' display names (used in activity feeds and
 * provenance views). The two helpers live in separate dirs because
 * they answer different questions: this one renders the signed-in
 * user's first name from auth metadata; the other resolves arbitrary
 * UUIDs to public-facing names via a SECURITY DEFINER RPC.
 */

export interface AuthUserShape {
  user_metadata?: Record<string, unknown> | null;
  email?: string | null;
}

export interface ResolvedDisplayName {
  /** The first-person greeting name, or null if nothing usable. */
  display_name: string | null;
  /**
   * True only when a real `display_name` or `full_name` was present in
   * `user_metadata`. Email-prefix derivations return `false` so the UI
   * can prompt the user to set a real display name.
   */
  has_display_name: boolean;
}

/**
 * Compute the signed-in user's first-person display name from their
 * Supabase auth user object.
 */
export function getUserDisplayName(
  authUser: AuthUserShape | null | undefined,
): ResolvedDisplayName {
  const rawDisplayName =
    (authUser?.user_metadata?.display_name as string | undefined) ??
    (authUser?.user_metadata?.full_name as string | undefined);

  if (rawDisplayName) {
    return {
      display_name: rawDisplayName.split(' ')[0] ?? rawDisplayName,
      has_display_name: true,
    };
  }

  if (authUser?.email) {
    const prefix = authUser.email.split('@')[0] ?? '';
    const cleaned = prefix.replace(/[._]+/g, ' ').replace(/\d+$/g, '').trim();
    if (cleaned.length > 0) {
      return {
        display_name:
          cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase(),
        has_display_name: false,
      };
    }
  }

  return { display_name: null, has_display_name: false };
}
