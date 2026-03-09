import { describe, it, expect } from 'vitest';
import { canonicalise } from '@/lib/entity-dedup';

describe('canonicalise', () => {
  describe('ISO standard normalisation', () => {
    it('inserts a space between ISO and digits: "ISO27001" becomes "ISO 27001"', () => {
      expect(canonicalise('ISO27001')).toBe('ISO 27001');
    });

    it('normalises "ISO 27001" (already correct) unchanged', () => {
      expect(canonicalise('ISO 27001')).toBe('ISO 27001');
    });

    it('handles lowercase iso prefix: "iso9001" becomes "ISO 9001"', () => {
      expect(canonicalise('iso9001')).toBe('ISO 9001');
    });

    it('strips ISO version suffixes: "ISO 27001:2022" becomes "ISO 27001"', () => {
      expect(canonicalise('ISO 27001:2022')).toBe('ISO 27001');
    });

    it('strips ISO version suffixes: "ISO 14001:2015" becomes "ISO 14001"', () => {
      expect(canonicalise('ISO 14001:2015')).toBe('ISO 14001');
    });

    it('handles ISO with extra whitespace: "ISO  27001" stays "ISO  27001"', () => {
      // The regex replaces ISO\s*(\d) — "ISO  27001" matches and becomes "ISO 27001"
      // Actually "ISO  2" matches ISO\s*(\d) => "ISO 2" then rest is "7001"
      expect(canonicalise('ISO  27001')).toBe('ISO 27001');
    });

    it('does not alter ISO without trailing digits: "ISO Standard" unchanged', () => {
      expect(canonicalise('ISO Standard')).toBe('ISO Standard');
    });
  });

  describe('Cyber Essentials normalisation', () => {
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
      expect(canonicalise('cyber essentials Plus')).toBe('Cyber Essentials Plus');
    });
  });

  describe('trailing period stripping', () => {
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
      // The regex /\.$/ only removes one trailing period
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

  describe('combined rules', () => {
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
