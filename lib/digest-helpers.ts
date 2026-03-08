/** Map digest_type to a human-readable display label */
export function digestTypeLabel(digestType: string): string {
  switch (digestType) {
    case 'weekly':
      return 'Weekly Digest';
    case 'daily':
      return 'Daily Digest';
    case 'custom':
      return 'Custom Digest';
    default:
      return 'Content Digest';
  }
}
