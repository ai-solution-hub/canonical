import { z } from 'zod';

/**
 * Shape of `form_instance_fields.geometry` (nullable jsonb, ID-147 TECH §3).
 * `pdf.py` normalises detected fill-slot bboxes into displayed (post-rotation)
 * top-left page-fraction space before persisting, so `left/top/width/height`
 * are already what the UI consumes — no rotation/y-flip math owed downstream
 * (grounding §4a: Extend `HighlightArea` and commonforms geometry share the
 * same %-0–100 / [0,1] top-left origin).
 *
 * The jsonb column carries no CHECK constraint, so shape integrity is
 * enforced here on read. A parse failure — malformed blob, legacy shape
 * (`table_index`/`row_index`), or missing field — is treated as ABSENT
 * geometry by every caller of `parseGeometry`, never a misaligned box
 * (PRODUCT §C4).
 */
export const geometrySchema = z.object({
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  page: z.number().int().min(1),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});

export type Geometry = z.infer<typeof geometrySchema>;

/**
 * Percentage-space rectangle (0–100, top-left origin) — structurally
 * compatible with Extend's `HighlightArea` type
 * (`components/procurement/extend/bounding-box-citations.tsx`) without this
 * domain module importing a UI component file.
 */
export interface PercentArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Validate a raw (`unknown`) jsonb value against `geometrySchema`. Returns
 * `null` — never throws — on any parse failure, so every call site can treat
 * the result as "geometry absent, degrade to the list, no box" (§C4) with a
 * single null check.
 */
export function parseGeometry(value: unknown): Geometry | null {
  const result = geometrySchema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * `left/top/width/height × 100` = Extend `HighlightArea` (%-0–100, top-left,
 * no flip — grounding §4a). `page`/`rotation` are not part of the rendered
 * rectangle; callers read `geometry.page` directly to place the box.
 */
export function geometryToHighlightArea(geometry: Geometry): PercentArea {
  return {
    left: geometry.left * 100,
    top: geometry.top * 100,
    width: geometry.width * 100,
    height: geometry.height * 100,
  };
}
