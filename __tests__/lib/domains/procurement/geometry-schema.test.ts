/**
 * ID-147.11 — geometrySchema zod validation for `form_instance_fields.geometry`
 * (TECH §3, PRODUCT §C4). The persisted jsonb carries no column CHECK, so shape
 * integrity is enforced here on read: `left/top/width/height` normalised-top-left
 * fractions in [0,1], `page` a 1-based int, `rotation` one of the four upright
 * page rotations. A parse failure is treated as ABSENT geometry — never a
 * misaligned box (§C4 degrade) — so `parseGeometry` returns `null` rather than
 * throwing.
 */
import { describe, it, expect } from 'vitest';

import {
  geometrySchema,
  parseGeometry,
  geometryToHighlightArea,
} from '@/lib/domains/procurement/geometry-schema';

const VALID_GEOMETRY = {
  left: 0.125,
  top: 0.3,
  width: 0.4,
  height: 0.05,
  page: 2,
  rotation: 90,
};

describe('geometrySchema — form_instance_fields.geometry shape (§C4)', () => {
  it('accepts a well-formed geometry blob', () => {
    expect(geometrySchema.safeParse(VALID_GEOMETRY).success).toBe(true);
  });

  it.each([
    ['left', { ...VALID_GEOMETRY, left: 1.5 }],
    ['left negative', { ...VALID_GEOMETRY, left: -0.1 }],
    ['top', { ...VALID_GEOMETRY, top: 1.01 }],
    ['width', { ...VALID_GEOMETRY, width: -0.01 }],
    ['height', { ...VALID_GEOMETRY, height: 1.2 }],
  ])('rejects an out-of-[0,1] %s fraction', (_label, blob) => {
    expect(geometrySchema.safeParse(blob).success).toBe(false);
  });

  it.each([
    ['zero', { ...VALID_GEOMETRY, page: 0 }],
    ['negative', { ...VALID_GEOMETRY, page: -1 }],
    ['non-integer', { ...VALID_GEOMETRY, page: 1.5 }],
  ])('rejects a %s page number', (_label, blob) => {
    expect(geometrySchema.safeParse(blob).success).toBe(false);
  });

  it('rejects a rotation outside {0,90,180,270}', () => {
    expect(
      geometrySchema.safeParse({ ...VALID_GEOMETRY, rotation: 45 }).success,
    ).toBe(false);
  });

  it.each([0, 90, 180, 270])(
    'accepts an upright rotation of %d',
    (rotation) => {
      expect(
        geometrySchema.safeParse({ ...VALID_GEOMETRY, rotation }).success,
      ).toBe(true);
    },
  );

  it('rejects a blob missing required fields', () => {
    expect(geometrySchema.safeParse({ left: 0.1, top: 0.1 }).success).toBe(
      false,
    );
  });
});

describe('parseGeometry — parse-failure degrades to absent geometry (§C4)', () => {
  it('returns the parsed geometry for a valid blob', () => {
    expect(parseGeometry(VALID_GEOMETRY)).toEqual(VALID_GEOMETRY);
  });

  it('returns null (never throws) for a malformed blob', () => {
    expect(() => parseGeometry({ left: 'not-a-number' })).not.toThrow();
    expect(parseGeometry({ left: 'not-a-number' })).toBeNull();
  });

  it('returns null for null, undefined, and legacy/unrelated shapes', () => {
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry(undefined)).toBeNull();
    expect(parseGeometry({ table_index: 1, row_index: 2 })).toBeNull();
  });
});

describe('geometryToHighlightArea — ×100, no y-flip (grounding §4a)', () => {
  it('converts [0,1] fractions to 0-100 percentages preserving top-left origin', () => {
    const geometry = parseGeometry(VALID_GEOMETRY);
    expect(geometry).not.toBeNull();

    const area = geometryToHighlightArea(geometry!);

    expect(area).toEqual({
      left: 12.5,
      top: 30,
      width: 40,
      height: 5,
    });
  });

  it('does not invert top (no bottom-left-to-top-left flip owed downstream)', () => {
    const nearTop = geometryToHighlightArea({
      left: 0,
      top: 0.02,
      width: 0.1,
      height: 0.1,
      page: 1,
      rotation: 0,
    });
    // A field near the top of the page (top fraction close to 0) must render
    // near the top of the overlay (area.top close to 0) — a flipped
    // implementation would instead push this close to 100.
    expect(nearTop.top).toBeLessThan(10);
  });
});
