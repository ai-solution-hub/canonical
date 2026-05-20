export type PrimaryFocus = 'bid_writing' | 'account_management' | 'marketing';

export const PRIMARY_FOCUS_OPTIONS: { value: PrimaryFocus; label: string }[] = [
  { value: 'bid_writing', label: 'Procurement writing' },
  { value: 'account_management', label: 'Account management' },
  { value: 'marketing', label: 'Marketing content' },
];
