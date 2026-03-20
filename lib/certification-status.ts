// Certification metadata interfaces and expiry status derivation

export interface CertificationMetadata {
  version?: string;
  issuing_body?: string;
  date_obtained?: string; // ISO 8601
  expiry_date?: string; // ISO 8601
  scope?: string;
  certificate_number?: string;
  holder?: 'self' | 'supplier';
  supplier_name?: string;
  notes?: string;
}

export interface FrameworkMetadata {
  round?: string;
  status?: 'active' | 'expired' | 'pending';
  date_joined?: string; // ISO 8601
  expiry_date?: string; // ISO 8601
  lot?: string;
  supplier_id?: string;
  notes?: string;
}

export interface RegistrationMetadata {
  registration_number?: string;
  date_registered?: string; // ISO 8601
  expiry_date?: string; // ISO 8601
  registering_body?: string;
  notes?: string;
}

export type ExpiryStatus = 'valid' | 'expiring_soon' | 'expired' | 'unknown';

export function deriveExpiryStatus(expiryDate?: string): ExpiryStatus {
  if (!expiryDate) return 'unknown';
  const expiry = new Date(expiryDate);
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  if (expiry < now) return 'expired';
  if (expiry.getTime() - now.getTime() < thirtyDays) return 'expiring_soon';
  return 'valid';
}
