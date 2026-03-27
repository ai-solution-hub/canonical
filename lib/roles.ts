export type UserRole = 'admin' | 'editor' | 'viewer';

export function canEdit(role: UserRole | null): boolean {
  return role === 'admin' || role === 'editor';
}

export function canAdmin(role: UserRole | null): boolean {
  return role === 'admin';
}
