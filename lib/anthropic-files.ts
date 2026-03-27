import { getAnthropicClient } from '@/lib/anthropic';
import { toFile } from '@anthropic-ai/sdk/core/uploads';

const FILES_BETA = 'files-api-2025-04-14';

/**
 * Upload a file to the Anthropic Files API for upload-once, query-many usage.
 * Returns the file ID which can be cached and reused across multiple messages.
 */
export async function uploadFileToAnthropic(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ fileId: string; filename: string }> {
  const client = getAnthropicClient();
  const file = await toFile(buffer, filename, { type: mimeType });

  const result = await client.beta.files.upload({
    file,
    betas: [FILES_BETA],
  });

  return {
    fileId: result.id,
    filename: result.filename,
  };
}

/**
 * Get file metadata from the Anthropic Files API.
 */
export async function getAnthropicFileMetadata(
  fileId: string,
): Promise<{ id: string; filename: string; size: number; createdAt: string }> {
  const client = getAnthropicClient();
  const result = await client.beta.files.retrieveMetadata(fileId, {
    betas: [FILES_BETA],
  });

  return {
    id: result.id,
    filename: result.filename,
    size: result.size_bytes,
    createdAt: result.created_at,
  };
}

/**
 * Delete a file from the Anthropic Files API.
 */
export async function deleteAnthropicFile(fileId: string): Promise<void> {
  const client = getAnthropicClient();
  await client.beta.files.delete(fileId, {
    betas: [FILES_BETA],
  });
}

