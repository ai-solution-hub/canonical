/**
 * Tests for lib/pipeline/error-classes.ts — Inv-25 7-class error vocabulary.
 *
 * Subtask ID-28.13 — TECH.md §P-8 failure-mode wiring. The error-classes
 * module is the canonical TS-side enumeration that the cocoindex Python
 * sidecar's webhook emitter populates, and the Vercel webhook route
 * validates against.
 *
 * Acceptance (per testStrategy):
 *   - PIPELINE_ERROR_CLASSES is the exact 7-element tuple from PRODUCT
 *     Inv-25 (stage-level, NOT pydantic-level sub-classes).
 *   - PipelineErrorClass is the union-of-literals type.
 *   - PipelineErrorClassSchema accepts every member, rejects unknown
 *     classes and non-string inputs.
 *
 * Reference:
 *   docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-25 (verbatim
 *   enumeration: extraction_validation_failed | extraction_provider_
 *   unavailable | postgres_write_failed | binary_conversion_failed |
 *   embedding_failed | entity_resolution_failed | qa_dedup_proposer_failed).
 */

import { describe, it, expect } from 'vitest';
import {
  PIPELINE_ERROR_CLASSES,
  PipelineErrorClassSchema,
  type PipelineErrorClass,
} from '@/lib/pipeline/error-classes';

// ---------------------------------------------------------------------------
// Enum exports
// ---------------------------------------------------------------------------

describe('PIPELINE_ERROR_CLASSES — Inv-25 7-class vocabulary', () => {
  it('contains exactly seven members', () => {
    expect(PIPELINE_ERROR_CLASSES).toHaveLength(7);
  });

  it('matches the Inv-25 enumeration verbatim', () => {
    // The set comparison is order-independent but membership-exact —
    // the brief specifies an ordered tuple in code, but PRODUCT Inv-25
    // does not pin order. Test by membership to keep refactors safe.
    expect(new Set(PIPELINE_ERROR_CLASSES)).toEqual(
      new Set([
        'extraction_validation_failed',
        'extraction_provider_unavailable',
        'postgres_write_failed',
        'binary_conversion_failed',
        'embedding_failed',
        'entity_resolution_failed',
        'qa_dedup_proposer_failed',
      ]),
    );
  });

  it('is a readonly tuple (const assertion)', () => {
    // The `as const` assertion narrows the array type to a readonly
    // tuple of literals so callers can use members as discriminants.
    // We can't assert TS readonly at runtime, so we verify that the
    // exported value is at least an array.
    expect(Array.isArray(PIPELINE_ERROR_CLASSES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

describe('PipelineErrorClassSchema — Zod runtime validation', () => {
  it('accepts every member of PIPELINE_ERROR_CLASSES', () => {
    for (const cls of PIPELINE_ERROR_CLASSES) {
      const result = PipelineErrorClassSchema.safeParse(cls);
      expect(result.success, `expected ${cls} to parse`).toBe(true);
    }
  });

  it('rejects an unknown class string', () => {
    const result = PipelineErrorClassSchema.safeParse(
      'totally_made_up_error_class',
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = PipelineErrorClassSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects a non-string value', () => {
    const result = PipelineErrorClassSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(PipelineErrorClassSchema.safeParse(null).success).toBe(false);
    expect(PipelineErrorClassSchema.safeParse(undefined).success).toBe(false);
  });

  it('rejects pydantic-level sub-class strings (different abstraction)', () => {
    // The pydantic-level mapping in scripts/cocoindex_pipeline/extraction.py
    // (`_PYDANTIC_ERROR_TO_ERROR_CLASS`) emits sub-classes like
    // `invalid_discriminator` / `missing_required` / `type_coercion`.
    // These are SUB-CLASSES within extraction_validation_failed — they
    // are NOT stage-level error classes and MUST NOT be accepted by the
    // stage-level Zod schema. Guard against accidental cross-pollination.
    const pydanticSubClasses = [
      'invalid_discriminator',
      'invalid_enum',
      'type_coercion',
      'unexpected_field',
      'missing_required',
      'is_instance_of',
      'value_error',
    ];
    for (const subClass of pydanticSubClasses) {
      const result = PipelineErrorClassSchema.safeParse(subClass);
      expect(
        result.success,
        `pydantic sub-class ${subClass} must NOT be a valid stage-level class`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Type-level contract (compile-time only — these tests verify that the
// type lines up via assignability; failures here would surface as
// tsc errors not vitest assertions).
// ---------------------------------------------------------------------------

describe('PipelineErrorClass type — TypeScript literal union', () => {
  it('is assignable from every PIPELINE_ERROR_CLASSES member', () => {
    // The literal types must be assignable. The runtime assertion is
    // tautological (we just round-trip the value through a typed var),
    // but the TS compiler enforces the relationship at build time.
    const validClass: PipelineErrorClass = 'extraction_validation_failed';
    expect(PIPELINE_ERROR_CLASSES.includes(validClass)).toBe(true);
  });
});
