import { z } from 'zod';

// ──────────────────────────────────────────
// AI Tool-Use Response Schemas
// ──────────────────────────────────────────
// Zod schemas for validating Claude AI responses returned via tool-use mode.
// Each schema mirrors the `input_schema` passed to Claude in the corresponding
// API route's tool definition.

/**
 * Schema for the `return_summary` tool response.
 * Used by: POST /api/summaries/generate, scripts/batch_generate_summaries.ts
 */
export const SummaryResponseSchema = z.object({
  executive: z.string(),
  detailed: z.string(),
  takeaways: z.array(z.string()),
});

export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;
