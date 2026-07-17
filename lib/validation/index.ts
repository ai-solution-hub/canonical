import { ZodError } from 'zod';
import type { z } from 'zod';
import { NextResponse } from 'next/server';

/**
 * Parse and validate a request body against a Zod schema.
 * Returns a discriminated union: either the validated data or a 400 NextResponse.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
):
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse } {
  try {
    const data = schema.parse(body);
    return { success: true, data };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        success: false,
        response: NextResponse.json(
          {
            error: 'Validation failed',
            details: err.issues.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
          { status: 400 },
        ),
      };
    }
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      ),
    };
  }
}

/**
 * Async variant of `parseBody` for schemas with async refinements
 * (e.g. `FeedSourceCreateSchema` whose `.superRefine` makes a network
 * call to validate web URLs). Wraps `schema.parseAsync()` so route files
 * never have to call `.safeParseAsync(` directly — the validation-sweep
 * guard rail (`__tests__/validation/validation-sweep.test.ts`) bans
 * inline `.safeParse(` and would otherwise reject async usage too.
 *
 * S222 W3-A §2.3.4 D-4 introduces the first async refinement — pre-insert
 * `validateWebUrl` for `source_type='web'` rows.
 */
export async function parseBodyAsync<T extends z.ZodType>(
  schema: T,
  body: unknown,
): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse }
> {
  try {
    const data = await schema.parseAsync(body);
    return { success: true, data };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        success: false,
        response: NextResponse.json(
          {
            error: 'Validation failed',
            details: err.issues.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
          { status: 400 },
        ),
      };
    }
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      ),
    };
  }
}

/**
 * Parse URL search params into an object and validate against a Zod schema.
 * Handles comma-separated arrays and numeric coercion.
 */
export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  params: URLSearchParams,
):
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse } {
  // Accumulate into a Map keyed by the user-controlled URL param name, then
  // convert with Object.fromEntries. Bracket-writing raw[key] with a
  // remote-controlled key is a property-injection / prototype-pollution sink
  // (CodeQL js/remote-property-injection); Map.set + Object.fromEntries avoids
  // it — fromEntries makes "__proto__" an own property, never mutating the
  // prototype — and is otherwise behaviour-identical (downstream Zod-validated).
  const raw = new Map<string, unknown>();

  // Collect all unique keys first — handles repeated params (e.g. domain=a&domain=b)
  const allKeys = new Set(params.keys());

  for (const key of allKeys) {
    const values = params.getAll(key);

    if (values.length > 1) {
      // Multiple values for the same key → always an array
      raw.set(key, values.flatMap((v) => v.split(',')).filter(Boolean));
    } else {
      const value = values[0];
      // Parse comma-separated values as arrays
      if (value.includes(',')) {
        raw.set(key, value.split(',').filter(Boolean));
      } else if (!isNaN(Number(value)) && value !== '') {
        raw.set(key, Number(value));
      } else {
        raw.set(key, value);
      }
    }
  }

  return parseBody(schema, Object.fromEntries(raw));
}
