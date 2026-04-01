import { describe, it, expect } from 'vitest';

import {
  isExcludedEntity,
  isInternalDocument,
  isGenericConcept,
  isRoleTitle,
  isProtocolOrFormat,
  isInsuranceOrContract,
  isManagementSystemAcronym,
  isGdprArtefact,
  shouldExcludeEntity,
} from '@/lib/ai/classify';
import type { ExtractedEntity } from '@/lib/ai/classify';

// ──────────────────────────────────────────
// isExcludedEntity (existing identifier patterns)
// ──────────────────────────────────────────

describe('isExcludedEntity', () => {
  it('excludes SIC codes', () => {
    expect(isExcludedEntity('SIC Code 62012')).toBe(true);
  });

  it('excludes VAT registration numbers', () => {
    expect(isExcludedEntity('VAT Registration Number')).toBe(true);
    expect(isExcludedEntity('VAT Reg')).toBe(true);
  });

  it('excludes DUNS numbers', () => {
    expect(isExcludedEntity('DUNS Number')).toBe(true);
  });

  it('excludes pure numeric identifiers', () => {
    expect(isExcludedEntity('222013943')).toBe(true);
    expect(isExcludedEntity('12345')).toBe(true);
  });

  it('does not exclude real entities', () => {
    expect(isExcludedEntity('ISO 27001')).toBe(false);
    expect(isExcludedEntity('GDPR')).toBe(false);
    expect(isExcludedEntity('NHS')).toBe(false);
  });
});

// ──────────────────────────────────────────
// isInternalDocument
// ──────────────────────────────────────────

describe('isInternalDocument', () => {
  it.each([
    'Information Security Policy',
    'Acceptable Use Policy',
    'Data Protection Policy',
    'Clear Desk Policy',
    'Remote and Flexible Working Policy',
    'Supplier Security Policy',
    'Business Continuity Plan',
    'Disaster Recovery Plan',
    'Incident Response Plan',
    'Staff Security Breach Process',
    'Data Retention Schedule',
    'Non-Disclosure Agreement',
    'Social Value Statement',
    'Secure Disposal Procedure',
    'Data Processing Agreement',
    'Visitor Access Register',
  ])('identifies internal document: %s', (name) => {
    expect(isInternalDocument(name)).toBe(true);
  });

  it.each([
    'ISO 27001',
    'GDPR',
    'Cyber Essentials Plus',
    'OWASP',
    'NHS',
    'ITIL',
    'Agile',
    'Microsoft Azure',
    'Public Sector',
  ])('does not exclude real entity: %s', (name) => {
    expect(isInternalDocument(name)).toBe(false);
  });

  it('handles case-insensitive matching', () => {
    expect(isInternalDocument('information security policy')).toBe(true);
    expect(isInternalDocument('BUSINESS CONTINUITY PLAN')).toBe(true);
  });

  it('handles leading/trailing whitespace', () => {
    expect(isInternalDocument('  Data Protection Policy  ')).toBe(true);
  });

  it.each([
    'Wales Safeguarding Procedure',
    'Working Together to Safeguard Children',
    'Keeping Children Safe in Education',
    'Government Security Classification Policy',
    'Modern Slavery Statement',
  ])('does not exclude statutory document: %s', (name) => {
    expect(isInternalDocument(name)).toBe(false);
  });

  it('statutory allowlist is case-insensitive', () => {
    expect(isInternalDocument('wales safeguarding procedure')).toBe(false);
    expect(isInternalDocument('GOVERNMENT SECURITY CLASSIFICATION POLICY')).toBe(false);
  });
});

// ──────────────────────────────────────────
// isGenericConcept
// ──────────────────────────────────────────

describe('isGenericConcept', () => {
  it.each([
    'information security',
    'business continuity',
    'data protection',
    'regulatory compliance',
    'encryption',
    'firewalls',
    'access control',
    'two-factor authentication',
    'multi-factor authentication',
    'disaster recovery',
    'penetration testing',
    'incident response',
    'risk management',
    'vulnerability management',
    'patch management',
    'physical security',
    'network security',
    'endpoint security',
    'data wiping',
    'physical destruction',
    'security monitoring',
    'threat detection',
  ])('identifies generic concept: %s', (name) => {
    expect(isGenericConcept(name)).toBe(true);
  });

  it.each([
    'ISO 27001',
    'GDPR',
    'Cyber Essentials',
    'OWASP',
    'NHS',
    'ITIL',
    'Agile',
    'Microsoft Azure',
    'AWS',
  ])('does not exclude real entity: %s', (name) => {
    expect(isGenericConcept(name)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isGenericConcept('Information Security')).toBe(true);
    expect(isGenericConcept('BUSINESS CONTINUITY')).toBe(true);
  });

  it('handles whitespace', () => {
    expect(isGenericConcept('  data protection  ')).toBe(true);
  });
});

// ──────────────────────────────────────────
// isRoleTitle
// ──────────────────────────────────────────

describe('isRoleTitle', () => {
  it.each([
    'Managing Director',
    'Account Manager',
    'Project Manager',
    'Technical Director',
    'IT Director',
    'Security Officer',
    'Chief Information Security Officer',
    'Data Protection Officer',
    'Client Project Lead',
    'CEO',
    'CTO',
    'CFO',
    'CISO',
    'DPO',
    'MD',
    'Senior Developer',
    'Lead Architect',
    'Operations Manager',
    'Quality Manager',
  ])('identifies role title: %s', (name) => {
    expect(isRoleTitle(name)).toBe(true);
  });

  it.each([
    'Matthew Burgess',
    'Jane Smith',
    'John Doe',
    'Alan Turing',
    'Matthew',
    'ISO 27001',
    'NHS',
    'Agile',
  ])('does not exclude person name or entity: %s', (name) => {
    expect(isRoleTitle(name)).toBe(false);
  });

  it('handles leading/trailing whitespace', () => {
    expect(isRoleTitle('  Managing Director  ')).toBe(true);
  });
});

// ──────────────────────────────────────────
// isProtocolOrFormat
// ──────────────────────────────────────────

describe('isProtocolOrFormat', () => {
  it.each([
    'HTTPS',
    'HTTP',
    'SSH',
    'SSL',
    'TLS',
    'FTP',
    'SFTP',
    'SMTP',
    'DNS',
    'PDF',
    'CSV',
    'HTML',
    'JSON',
    'XML',
    'JavaScript',
    'SQL',
    'AES-256',
    'SHA-256',
    'RSA',
    'PBKDF2',
    'HMAC',
    'PBKDF2-HMAC-SHA256',
  ])('identifies protocol/format/algorithm: %s', (name) => {
    expect(isProtocolOrFormat(name)).toBe(true);
  });

  it.each([
    'AWS',
    'Azure',
    'Microsoft 365',
    'SharePoint',
    'ServiceNow',
    'WordPress',
    'Jira',
    'ISO 27001',
    'GDPR',
  ])('does not exclude real technology/entity: %s', (name) => {
    expect(isProtocolOrFormat(name)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isProtocolOrFormat('https')).toBe(true);
    expect(isProtocolOrFormat('HTTPS')).toBe(true);
    expect(isProtocolOrFormat('Https')).toBe(true);
  });
});

// ──────────────────────────────────────────
// isInsuranceOrContract
// ──────────────────────────────────────────

describe('isInsuranceOrContract', () => {
  it.each([
    'professional indemnity insurance',
    'public liability insurance',
    'cyber liability insurance',
    'non-disclosure agreement',
    'service level agreement',
    'data processing agreement',
    'master services agreement',
  ])('identifies insurance/contract: %s', (name) => {
    expect(isInsuranceOrContract(name)).toBe(true);
  });

  it.each([
    'ISO 27001',
    'GDPR',
    'Cyber Essentials',
    'AWS',
    'NHS',
  ])('does not exclude real entity: %s', (name) => {
    expect(isInsuranceOrContract(name)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isInsuranceOrContract('Professional Indemnity Insurance')).toBe(true);
  });
});

// ──────────────────────────────────────────
// isManagementSystemAcronym
// ──────────────────────────────────────────

describe('isManagementSystemAcronym', () => {
  it.each([
    'ISMS',
    'QMS',
    'EMS',
    'IMS',
    'Information Security Management System',
    'Quality Management System',
    'Environmental Management System',
    'Integrated Management System',
  ])('identifies management system: %s', (name) => {
    expect(isManagementSystemAcronym(name)).toBe(true);
  });

  it.each([
    'ISO 27001',
    'ISO 9001',
    'ISO 14001',
    'Cyber Essentials',
    'ITIL',
  ])('does not exclude certifications/frameworks: %s', (name) => {
    expect(isManagementSystemAcronym(name)).toBe(false);
  });
});

// ──────────────────────────────────────────
// isGdprArtefact
// ──────────────────────────────────────────

describe('isGdprArtefact', () => {
  it.each([
    'Records of Processing Activity',
    'Data Processing Agreement',
    'Data Protection Impact Assessment',
    'Data Protection by Design and Default',
    'Technical and Organisational Measures',
    'Consent',
    'Contractual Necessity',
    'Legal Obligation',
    'Legitimate Interest',
    'Lawful Basis',
    'Data Subject Access Request',
    'Right to Erasure',
  ])('identifies GDPR artefact: %s', (name) => {
    expect(isGdprArtefact(name)).toBe(true);
  });

  it.each([
    'GDPR',
    'Data Protection Act 2018',
    'ICO',
    'PECR',
  ])('does not exclude real regulations: %s', (name) => {
    expect(isGdprArtefact(name)).toBe(false);
  });
});

// ──────────────────────────────────────────
// shouldExcludeEntity (composite filter)
// ──────────────────────────────────────────

describe('shouldExcludeEntity', () => {
  function entity(name: string, type: string, canonical_name?: string): ExtractedEntity {
    return {
      name,
      type: type as ExtractedEntity['type'],
      canonical_name: canonical_name ?? name,
    };
  }

  it('excludes internal documents', () => {
    expect(shouldExcludeEntity(entity('Information Security Policy', 'framework'))).toBe(true);
    expect(shouldExcludeEntity(entity('Business Continuity Plan', 'capability'))).toBe(true);
  });

  it('excludes generic concepts', () => {
    expect(shouldExcludeEntity(entity('information security', 'capability'))).toBe(true);
    expect(shouldExcludeEntity(entity('data protection', 'regulation'))).toBe(true);
  });

  it('excludes role titles only when type is person', () => {
    expect(shouldExcludeEntity(entity('Managing Director', 'person'))).toBe(true);
    // Not excluded as a non-person type (though still might be wrong type)
    expect(shouldExcludeEntity(entity('Managing Director', 'capability'))).toBe(false);
  });

  it('excludes protocols and formats', () => {
    expect(shouldExcludeEntity(entity('HTTPS', 'technology'))).toBe(true);
    expect(shouldExcludeEntity(entity('PDF', 'technology'))).toBe(true);
    expect(shouldExcludeEntity(entity('AES-256', 'standard'))).toBe(true);
  });

  it('excludes insurance and contract types', () => {
    expect(shouldExcludeEntity(entity('Professional Indemnity Insurance', 'product'))).toBe(true);
    expect(shouldExcludeEntity(entity('Non-Disclosure Agreement', 'standard'))).toBe(true);
  });

  it('excludes management system acronyms', () => {
    expect(shouldExcludeEntity(entity('ISMS', 'framework'))).toBe(true);
    expect(shouldExcludeEntity(entity('Quality Management System', 'certification'))).toBe(true);
  });

  it('excludes GDPR artefacts', () => {
    expect(shouldExcludeEntity(entity('Records of Processing Activity', 'framework'))).toBe(true);
    expect(shouldExcludeEntity(entity('Data Subject Access Request', 'regulation'))).toBe(true);
  });

  it('does not exclude real entities', () => {
    expect(shouldExcludeEntity(entity('ISO 27001', 'certification'))).toBe(false);
    expect(shouldExcludeEntity(entity('GDPR', 'regulation'))).toBe(false);
    expect(shouldExcludeEntity(entity('NHS', 'organisation'))).toBe(false);
    expect(shouldExcludeEntity(entity('OWASP', 'framework'))).toBe(false);
    expect(shouldExcludeEntity(entity('Agile', 'methodology'))).toBe(false);
    expect(shouldExcludeEntity(entity('AWS', 'technology'))).toBe(false);
    expect(shouldExcludeEntity(entity('ITIL', 'framework'))).toBe(false);
    expect(shouldExcludeEntity(entity('Cyber Essentials Plus', 'certification'))).toBe(false);
    expect(shouldExcludeEntity(entity('Matthew Burgess', 'person'))).toBe(false);
    expect(shouldExcludeEntity(entity('Public Sector', 'sector'))).toBe(false);
    expect(shouldExcludeEntity(entity('BS 5839', 'standard'))).toBe(false);
    expect(shouldExcludeEntity(entity('PRINCE2', 'methodology'))).toBe(false);
  });

  it('excludes identifier patterns via isExcludedEntity', () => {
    expect(shouldExcludeEntity(entity('SIC Code 62012', 'organisation'))).toBe(true);
    expect(shouldExcludeEntity(entity('VAT Registration', 'certification'))).toBe(true);
  });

  it('checks both name and canonical_name for internal documents', () => {
    expect(
      shouldExcludeEntity(entity('our security policy', 'framework', 'Information Security Policy')),
    ).toBe(true);
  });

  it('checks canonical_name for generic concepts', () => {
    expect(
      shouldExcludeEntity(entity('info sec', 'capability', 'information security')),
    ).toBe(true);
  });
});
