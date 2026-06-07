import { describe, it, expect } from 'vitest';
import { canonicalise } from '@/lib/entities/entity-dedup';

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

    it('normalises "ISO 27001" (already correct) unchanged', () => {
      expect(canonicalise('ISO 27001')).toBe('ISO 27001');
    });

    it('handles lowercase iso prefix: "iso9001" becomes "ISO 9001"', () => {
      expect(canonicalise('iso9001')).toBe('ISO 9001');
    });

    it('strips version suffix: ISO 27001:2022 → ISO 27001', () => {
      expect(canonicalise('ISO 27001:2022')).toBe('ISO 27001');
    });

    it('strips version suffix: ISO 27001:2013 → ISO 27001', () => {
      expect(canonicalise('ISO 27001:2013')).toBe('ISO 27001');
    });

    it('strips version suffix: ISO 14001:2015 → ISO 14001', () => {
      expect(canonicalise('ISO 14001:2015')).toBe('ISO 14001');
    });

    it('handles ISO with extra whitespace: "ISO  27001" → "ISO 27001"', () => {
      expect(canonicalise('ISO  27001')).toBe('ISO 27001');
    });

    it('does not alter ISO without trailing digits: "ISO Standard" unchanged', () => {
      expect(canonicalise('ISO Standard')).toBe('ISO Standard');
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
    it('Examplia Design Ltd → Examplia Design Limited', () => {
      expect(canonicalise('Examplia Design Ltd')).toBe(
        'Examplia Design Limited',
      );
    });

    it('Examplia Design Ltd. → Examplia Design Limited', () => {
      expect(canonicalise('Examplia Design Ltd.')).toBe(
        'Examplia Design Limited',
      );
    });

    it('some company plc → Some Company PLC', () => {
      expect(canonicalise('some company plc')).toBe('Some Company PLC');
    });

    it('Example Inc. → Example Inc', () => {
      expect(canonicalise('Example Inc.')).toBe('Example Inc');
    });
  });

  describe('multi-word title case', () => {
    it('examplia design limited → Examplia Design Limited', () => {
      expect(canonicalise('examplia design limited')).toBe(
        'Examplia Design Limited',
      );
    });

    it('examplia → Examplia (single non-abbreviation word)', () => {
      expect(canonicalise('examplia')).toBe('Examplia');
    });

    it('gdpr stays GDPR (single-word abbreviation)', () => {
      expect(canonicalise('gdpr')).toBe('GDPR');
    });

    it('preserves already-correct names', () => {
      expect(canonicalise('Examplia Design Limited')).toBe(
        'Examplia Design Limited',
      );
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
      expect(canonicalise('Access Controls', 'capability')).toBe(
        'Access Control',
      );
    });

    it('does not strip plural without entity type', () => {
      expect(canonicalise('Access Controls')).toBe('Access Controls');
    });

    it('does not strip plural for organisation type', () => {
      expect(canonicalise('Williams Corp', 'organisation')).toBe(
        'Williams Corp',
      );
    });

    it('does not strip from single-word names', () => {
      expect(canonicalise('Firewalls', 'technology')).toBe('Firewalls');
    });

    it('does not strip double-s endings', () => {
      expect(canonicalise('Data Access', 'capability')).toBe('Data Access');
    });

    it('does not strip -us endings (not real plurals)', () => {
      expect(canonicalise('SME Status', 'certification')).toBe('SME Status');
    });

    it('converts -ies → -y (Policies → Policy)', () => {
      expect(canonicalise('Compliance Policies', 'regulation')).toBe(
        'Compliance Policy',
      );
    });

    it('converts -ies → -y (Libraries → Library)', () => {
      expect(canonicalise('Third Party Libraries', 'technology')).toBe(
        'Third Party Library',
      );
    });

    it('preserves Cyber Essentials Plus (certification)', () => {
      expect(canonicalise('Cyber Essentials Plus', 'certification')).toBe(
        'Cyber Essentials Plus',
      );
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

    it('capitalises "cyber essentials" to "Cyber Essentials"', () => {
      expect(canonicalise('cyber essentials')).toBe('Cyber Essentials');
    });

    it('normalises "CYBER ESSENTIALS" to "Cyber Essentials"', () => {
      expect(canonicalise('CYBER ESSENTIALS')).toBe('Cyber Essentials');
    });

    it('normalises "CyberEssentials" (no space) to "Cyber Essentials"', () => {
      expect(canonicalise('CyberEssentials')).toBe('Cyber Essentials');
    });

    it('normalises "cyber  essentials" (extra space) to "Cyber Essentials"', () => {
      expect(canonicalise('cyber  essentials')).toBe('Cyber Essentials');
    });

    it('preserves text after "Cyber Essentials": "Cyber Essentials Plus"', () => {
      expect(canonicalise('cyber essentials Plus')).toBe(
        'Cyber Essentials Plus',
      );
    });

    it('normalises "CYBER ESSENTIALS PLUS" to "Cyber Essentials Plus"', () => {
      expect(canonicalise('CYBER ESSENTIALS PLUS')).toBe(
        'Cyber Essentials Plus',
      );
    });

    it('normalises "cyber essentials plus" (all lowercase) to "Cyber Essentials Plus"', () => {
      expect(canonicalise('cyber essentials plus')).toBe(
        'Cyber Essentials Plus',
      );
    });

    it('Cyber Essentials PLUS → Cyber Essentials Plus', () => {
      expect(canonicalise('Cyber Essentials PLUS')).toBe(
        'Cyber Essentials Plus',
      );
    });
  });

  describe('trailing period stripping', () => {
    it('strips trailing period', () => {
      expect(canonicalise('Examplia Design Limited.')).toBe(
        'Examplia Design Limited',
      );
    });

    it('strips a trailing period from "BSI."', () => {
      expect(canonicalise('BSI.')).toBe('BSI');
    });

    it('strips trailing period from "National Cyber Security Centre."', () => {
      expect(canonicalise('National Cyber Security Centre.')).toBe(
        'National Cyber Security Centre',
      );
    });

    it('does not strip periods in the middle of text: "St. James"', () => {
      expect(canonicalise('St. James')).toBe('St. James');
    });

    it('strips only a single trailing period, not multiple: "BSI.." leaves "BSI."', () => {
      expect(canonicalise('BSI..')).toBe('BSI.');
    });
  });

  describe('whitespace trimming', () => {
    it('trims leading whitespace', () => {
      expect(canonicalise('  BSI')).toBe('BSI');
    });

    it('trims trailing whitespace', () => {
      expect(canonicalise('BSI  ')).toBe('BSI');
    });

    it('trims both leading and trailing whitespace', () => {
      expect(canonicalise('  ISO 27001  ')).toBe('ISO 27001');
    });

    it('handles a string that is only whitespace', () => {
      expect(canonicalise('   ')).toBe('');
    });
  });

  describe('slug-to-proper-case conversion (extended)', () => {
    it('converts "data-protection-act-2018" to proper case', () => {
      expect(canonicalise('data-protection-act-2018')).toBe(
        'Data Protection Act 2018',
      );
    });

    it('converts "owasp-top-10" preserving OWASP abbreviation', () => {
      expect(canonicalise('owasp-top-10')).toBe('OWASP Top 10');
    });

    it('does not convert names with spaces (already proper)', () => {
      expect(canonicalise('Penetration Testing')).toBe('Penetration Testing');
    });

    it('handles underscores as word separators', () => {
      expect(canonicalise('access_control')).toBe('Access Control');
    });
  });

  describe('single-word abbreviation fixing', () => {
    it('fixes lowercase "crest" to "CREST"', () => {
      expect(canonicalise('crest')).toBe('CREST');
    });

    it('fixes lowercase "owasp" to "OWASP"', () => {
      expect(canonicalise('owasp')).toBe('OWASP');
    });
  });

  describe('passthrough of normal names', () => {
    it('returns a normal organisation name unchanged', () => {
      expect(canonicalise('Acme Corporation')).toBe('Acme Corporation');
    });

    it('returns a normal technology name unchanged', () => {
      expect(canonicalise('Kubernetes')).toBe('Kubernetes');
    });

    it('returns a normal person name unchanged', () => {
      expect(canonicalise('Jane Smith')).toBe('Jane Smith');
    });

    it('returns an empty string unchanged', () => {
      expect(canonicalise('')).toBe('');
    });
  });

  describe('combined rules (extended)', () => {
    it('trims whitespace and normalises ISO: " ISO27001 "', () => {
      expect(canonicalise(' ISO27001 ')).toBe('ISO 27001');
    });

    it('trims whitespace and strips trailing period: " BSI. "', () => {
      expect(canonicalise(' BSI. ')).toBe('BSI');
    });

    it('normalises Cyber Essentials and strips trailing period', () => {
      expect(canonicalise('cyber essentials.')).toBe('Cyber Essentials');
    });
  });
});
