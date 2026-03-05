/**
 * Shared helpers for user role display.
 *
 * Extracted from profile-section.tsx and team-section.tsx to avoid duplication.
 */

/** Map a user role string to the appropriate badge variant. */
export function roleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'admin':
      return 'default';
    case 'editor':
      return 'secondary';
    default:
      return 'outline';
  }
}

/** Title-case a role string for display (e.g. "admin" -> "Admin"). */
export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
