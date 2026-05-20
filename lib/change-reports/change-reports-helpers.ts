/** Map digest_type to a human-readable display label */
export function digestTypeLabel(digestType: string): string {
  switch (digestType) {
    case 'weekly':
      return 'Weekly Change Report';
    case 'daily':
      return 'Daily Change Report';
    case 'custom':
      return 'Custom Change Report';
    default:
      return 'Change Report';
  }
}
