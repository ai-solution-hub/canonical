/**
 * Regression tests for S157 WP2 — post-canonicalise filter application point fix.
 *
 * Background: the diagnostic report §D-Q4 surfaced a paradox where
 * `shouldExcludeEntity` catches generic concepts / GDPR artefacts when
 * given exact canonical names, but the live pipeline stored them anyway
 * because Claude returns non-normalised forms (e.g. plural "Data
 * Protection Impact Assessments"). `canonicalise()` then normalises them
 * AFTER the filter has already run.
 *
 * The fix adds a second filter pass on the CANONICALISED `entityRows`
 * before the `entity_mentions` upsert. These tests prove the fix works:
 *
 *   (a) Pre-canonicalise filter MISSES `"Data Protection Impact Assessments"`
 *       (plural) because the entry in GDPR_ARTEFACTS is singular.
 *   (b) `canonicalise()` strips the plural 's' for DEPLURAL_TYPES
 *       (regulation, capability, framework, etc.).
 *   (c) Post-canonicalise filter CATCHES `"data protection impact assessment"`.
 *
 * Source: `docs/audits/s154-entity-classification-diagnostic-report.md` §D-Q4.
 */

import { describe, it, expect } from 'vitest';
import { shouldExcludeEntity, type ExtractedEntity } from '@/lib/ai/classify';
import { canonicalise } from '@/lib/entities/entity-dedup';
import { resolveAlias } from '@/lib/entities/entity-aliases';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

/**
 * Mirror the canonicalisation pipeline used by `lib/ai/classify.ts:1119-1121`
 * to construct the exact `canonical_name` that would be stored in
 * `entity_mentions`. Stored form is lowercase; filter runs BEFORE lowercase
 * in the pre-canonicalise Step 14a check, and AFTER lowercase in the
 * post-canonicalise Step 15a check.
 */
function canonicaliseAsStored(rawCanonical: string, type: string): string {
  return resolveAlias(canonicalise(rawCanonical, type)).toLowerCase();
}

describe('S157 WP2 — post-canonicalise filter application point fix', () => {
  describe('D-Q4 paradox reproduction — plural GDPR artefact', () => {
    // Classifier output: plural "Data Protection Impact Assessments" with
    // type 'regulation' (a DEPLURAL_TYPES member).
    const rawEntity: ExtractedEntity = {
      name: 'Data Protection Impact Assessments',
      type: 'regulation',
      canonical_name: 'Data Protection Impact Assessments',
    };

    it('(a) pre-canonicalise filter MISSES the plural form', () => {
      // The pre-canonicalise filter sees the plural as-returned by Claude.
      // `isGdprArtefact` checks against a set that only contains the
      // singular "data protection impact assessment" — so the plural
      // slips through.
      expect(shouldExcludeEntity(rawEntity)).toBe(false);
    });

    it('(b) canonicalise() strips the plural for DEPLURAL_TYPES', () => {
      // `regulation` is in DEPLURAL_TYPES. Multi-word, length > 4,
      // last word "Assessments" ends in "s" (not "ss"/"us"/"is"),
      // not an abbreviation → strip the trailing 's'.
      const canonical = canonicaliseAsStored(
        rawEntity.canonical_name,
        rawEntity.type,
      );
      expect(canonical).toBe('data protection impact assessment');
    });

    it('(c) post-canonicalise filter CATCHES the canonicalised form', () => {
      // Build the synthetic ExtractedEntity as the post-canonicalise filter
      // in classify.ts:Step 15a would: entity_name preserved, canonical_name
      // replaced with the stored form, type unchanged.
      const canonical = canonicaliseAsStored(
        rawEntity.canonical_name,
        rawEntity.type,
      );
      const postCanonicaliseEntity: ExtractedEntity = {
        name: rawEntity.name, // original display name
        type: rawEntity.type,
        canonical_name: canonical,
      };
      expect(shouldExcludeEntity(postCanonicaliseEntity)).toBe(true);
    });
  });

  describe('D-Q4 paradox reproduction — plural "Data Processing Agreements"', () => {
    // Second worked example: the `isInternalDocument` suffix check uses
    // `/agreement$/i` which DOES NOT match the plural "agreements" at
    // end-of-string. So plural form slips the pre-canonicalise filter.
    const rawEntity: ExtractedEntity = {
      name: 'Data Processing Agreements',
      type: 'regulation',
      canonical_name: 'Data Processing Agreements',
    };

    it('pre-canonicalise filter misses plural "Data Processing Agreements"', () => {
      expect(shouldExcludeEntity(rawEntity)).toBe(false);
    });

    it('post-canonicalise filter catches singular "data processing agreement"', () => {
      const canonical = canonicaliseAsStored(
        rawEntity.canonical_name,
        rawEntity.type,
      );
      expect(canonical).toBe('data processing agreement');
      expect(
        shouldExcludeEntity({
          name: rawEntity.name,
          type: rawEntity.type,
          canonical_name: canonical,
        }),
      ).toBe(true);
    });
  });

  describe('D-Q4 paradox reproduction — plural internal document suffix', () => {
    // `/policy$/i` matches singular "policy" at end-of-string, but not
    // plural "policies". Classifier outputs "Information Security Policies"
    // → pre-filter misses → canonicalise() converts "Policies" → "Policy"
    // (via the `ies` → `y` rule) → post-filter catches via the suffix.
    const rawEntity: ExtractedEntity = {
      name: 'Information Security Policies',
      type: 'regulation',
      canonical_name: 'Information Security Policies',
    };

    it('pre-canonicalise filter misses plural "Policies"', () => {
      // `isInternalDocument` suffix check runs `/policy$/i` which fails
      // on "Policies". It also runs `isGenericConcept` on the lowercased
      // form, which is not in GENERIC_CONCEPTS.
      expect(shouldExcludeEntity(rawEntity)).toBe(false);
    });

    it('post-canonicalise filter catches singular "information security policy"', () => {
      const canonical = canonicaliseAsStored(
        rawEntity.canonical_name,
        rawEntity.type,
      );
      expect(canonical).toBe('information security policy');
      expect(
        shouldExcludeEntity({
          name: rawEntity.name,
          type: rawEntity.type,
          canonical_name: canonical,
        }),
      ).toBe(true);
    });
  });

  describe('negative controls — legitimate entities still pass both filters', () => {
    it('"ISO 27001" with type "standard" passes both pre and post filters', () => {
      const rawEntity: ExtractedEntity = {
        name: 'ISO 27001',
        type: 'standard',
        canonical_name: 'ISO 27001',
      };
      expect(shouldExcludeEntity(rawEntity)).toBe(false);

      const canonical = canonicaliseAsStored('ISO 27001', 'standard');
      expect(canonical).toBe('iso 27001');
      expect(
        shouldExcludeEntity({
          name: 'ISO 27001',
          type: 'standard',
          canonical_name: canonical,
        }),
      ).toBe(false);
    });

    it('"Microsoft Azure" with type "technology" passes both filters', () => {
      const rawEntity: ExtractedEntity = {
        name: 'Microsoft Azure',
        type: 'technology',
        canonical_name: 'Microsoft Azure',
      };
      expect(shouldExcludeEntity(rawEntity)).toBe(false);

      const canonical = canonicaliseAsStored('Microsoft Azure', 'technology');
      expect(canonical).toBe('microsoft azure');
      expect(
        shouldExcludeEntity({
          name: 'Microsoft Azure',
          type: 'technology',
          canonical_name: canonical,
        }),
      ).toBe(false);
    });

    it('"Example Client Limited" with type "organisation" passes both filters', () => {
      const rawEntity: ExtractedEntity = {
        name: 'Example Client Limited',
        type: 'organisation',
        canonical_name: 'Example Client Limited',
      };
      expect(shouldExcludeEntity(rawEntity)).toBe(false);

      // organisation is NOT in DEPLURAL_TYPES, so no plural stripping.
      const canonical = canonicaliseAsStored(
        'Example Client Limited',
        'organisation',
      );
      expect(canonical).toBe('example client limited');
      expect(
        shouldExcludeEntity({
          name: 'Example Client Limited',
          type: 'organisation',
          canonical_name: canonical,
        }),
      ).toBe(false);
    });
  });
});
