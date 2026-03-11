import { describe, it, expect } from 'vitest';
import { canonicalise } from '@/lib/entity-dedup';

describe('canonicalise', () => {
  // ── Existing rules (regression) ────────────────────────────────────

  describe('whitespace and slugs', () => {
    it('trims whitespace', () => {
      expect(canonicalise('  GDPR  ')).toBe('GDPR');
    });

    it('converts slug to proper case', () => {
      expect(canonicalise('penetration-testing')).toBe('Penetration Testing');
    });

    it('preserves abbreviations in slugs', () => {
      expect(canonicalise('uk-gdpr')).toBe('UK GDPR');
    });
  });

  describe('ISO standard normalisation (basic)', () => {
    it('adds space: ISO27001 → ISO 27001', () => {
      expect(canonicalise('ISO27001')).toBe('ISO 27001');
    });

    it('strips version suffix: ISO 27001:2022 → ISO 27001', () => {
      expect(canonicalise('ISO 27001:2022')).toBe('ISO 27001');
    });

    it('strips version suffix: ISO 27001:2013 → ISO 27001', () => {
      expect(canonicalise('ISO 27001:2013')).toBe('ISO 27001');
    });
  });

  // ── New rules (Phase 1) ────────────────────────────────────────────

  describe('ISO extended format normalisation', () => {
    it('ISO/IEC 27001 → ISO 27001', () => {
      expect(canonicalise('ISO/IEC 27001')).toBe('ISO 27001');
    });

    it('ISO-27001 → ISO 27001', () => {
      expect(canonicalise('ISO-27001')).toBe('ISO 27001');
    });

    it('Iso Iec 27001 → ISO 27001', () => {
      expect(canonicalise('Iso Iec 27001')).toBe('ISO 27001');
    });

    it('iso/iec 27001 (all lowercase) → ISO 27001', () => {
      expect(canonicalise('iso/iec 27001')).toBe('ISO 27001');
    });

    it('ISO 27001 2013 (space-separated year) → ISO 27001', () => {
      expect(canonicalise('ISO 27001 2013')).toBe('ISO 27001');
    });
  });

  describe('company suffix normalisation', () => {
    it('example-client Design Ltd → Example Client Ltd', () => {
      expect(canonicalise('example-client Design Ltd')).toBe('Example Client Ltd');
    });

    it('example-client Design Ltd. → Example Client Ltd', () => {
      expect(canonicalise('example-client Design Ltd.')).toBe('Example Client Ltd');
    });

    it('some company plc → Some Company PLC', () => {
      expect(canonicalise('some company plc')).toBe('Some Company PLC');
    });

    it('Example Inc. → Example Inc', () => {
      expect(canonicalise('Example Inc.')).toBe('Example Inc');
    });
  });

  describe('multi-word title case', () => {
    it('Example Client Ltd → Example Client Ltd', () => {
      expect(canonicalise('Example Client Ltd')).toBe('Example Client Ltd');
    });

    it('example-client → example-client (single non-abbreviation word)', () => {
      expect(canonicalise('example-client')).toBe('example-client');
    });

    it('gdpr stays GDPR (single-word abbreviation)', () => {
      expect(canonicalise('gdpr')).toBe('GDPR');
    });

    it('preserves already-correct names', () => {
      expect(canonicalise('Example Client Ltd')).toBe('Example Client Ltd');
    });
  });

  describe('WCAG normalisation', () => {
    it('Wcag 2 1 Aa → WCAG 2.1 AA', () => {
      expect(canonicalise('Wcag 2 1 Aa')).toBe('WCAG 2.1 AA');
    });

    it('wcag 2 1 aa → WCAG 2.1 AA', () => {
      expect(canonicalise('wcag 2 1 aa')).toBe('WCAG 2.1 AA');
    });

    it('wcag alone → WCAG', () => {
      expect(canonicalise('wcag')).toBe('WCAG');
    });

    it('WCAG 2.1 AA is preserved', () => {
      expect(canonicalise('WCAG 2.1 AA')).toBe('WCAG 2.1 AA');
    });
  });

  describe('plural normalisation (type-aware)', () => {
    it('Access Controls → Access Control (capability)', () => {
      expect(canonicalise('Access Controls', 'capability')).toBe('Access Control');
    });

    it('does not strip plural without entity type', () => {
      expect(canonicalise('Access Controls')).toBe('Access Controls');
    });

    it('does not strip plural for organisation type', () => {
      expect(canonicalise('Williams', 'organisation')).toBe('Williams');
    });

    it('does not strip from short words', () => {
      expect(canonicalise('APIs', 'technology')).toBe('APIs');
    });

    it('does not strip double-s endings', () => {
      expect(canonicalise('Business', 'capability')).toBe('Business');
    });
  });

  describe('combined slug + ISO handling', () => {
    it('iso-27001-compliance → ISO 27001 Compliance', () => {
      expect(canonicalise('iso-27001-compliance')).toBe('ISO 27001 Compliance');
    });
  });

  describe('Cyber Essentials (regression)', () => {
    it('cyberessentials → Cyber Essentials', () => {
      expect(canonicalise('cyberessentials')).toBe('Cyber Essentials');
    });

    it('Cyber Essentials PLUS → Cyber Essentials Plus', () => {
      expect(canonicalise('Cyber Essentials PLUS')).toBe('Cyber Essentials Plus');
    });
  });

  describe('trailing period stripping', () => {
    it('strips trailing period', () => {
      expect(canonicalise('Example Client Ltd.')).toBe('Example Client Ltd');
    });
  });
});
