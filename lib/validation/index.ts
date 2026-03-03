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
 * Parse URL search params into an object and validate against a Zod schema.
 * Handles comma-separated arrays and numeric coercion.
 */
export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  params: URLSearchParams,
):
  | { success: true; data: z.infer<T> }
  | { success: false; response: NextResponse } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    // Parse comma-separated values as arrays
    if (value.includes(',')) {
      raw[key] = value.split(',').filter(Boolean);
    } else if (!isNaN(Number(value)) && value !== '') {
      raw[key] = Number(value);
    } else {
      raw[key] = value;
    }
  }
  return parseBody(schema, raw);
}

// Re-export schema utilities for convenient imports
export { validateEditableField } from './schemas';
