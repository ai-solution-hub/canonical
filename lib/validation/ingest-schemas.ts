/**
 * Validation schemas for the URL ingestion pipeline.
 */

import { z } from 'zod';
import { VALID_CONTENT_TYPES } from './schemas';

/** POST /api/ingest/url — ingest content from a URL */
export const IngestUrlBodySchema = z.object({
  url: z.string().url().max(2000),
  content_type: z.enum(VALID_CONTENT_TYPES).optional(),
  user_tags: z.array(z.string().max(100)).max(50).optional(),

  // Admin-only dedup override (spec §6 D2). Non-admins passing this
  // flag are silently ignored — the dedup stamp proceeds as normal.
  skip_dedup: z.boolean().optional(),
});

export type IngestUrlBody = z.infer<typeof IngestUrlBodySchema>;
