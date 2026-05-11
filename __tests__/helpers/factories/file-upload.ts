/**
 * Canonical mock-File + upload-request factory for upload-route tests.
 *
 * Replaces 5+ copy-pasted `createMockFile()` / `buildFakeFile()` /
 * `createTestFile()` / `buildUploadRequest()` definitions across
 * `__tests__/api/`, `__tests__/components/`, and `__tests__/hooks/` per W-RG
 * in `remediation-plan.md` §3.8 and the S37 audit Agent A finding C6
 * (`agent-a-output.md` §C6 file-upload cluster).
 *
 * Two file-construction strategies exist in the audited cohort:
 *
 * 1. **Object.create(File.prototype) + Blob backing** (api-route tests).
 *    Spoofs `instanceof File` checks done by `formData.get('file')`
 *    consumers. Required because the api routes call `arrayBuffer()` on
 *    the File and the test asserts on the resulting bytes.
 * 2. **`new File([buffer], name, { type })`** (component / hook tests).
 *    Plain DOM `File` constructor — works in jsdom where `instanceof File`
 *    is the same realm.
 *
 * Default to strategy (1) because the api-route consumers are the majority
 * (5 of 7) and strategy (2) is satisfied by passing
 * `{ construction: 'plain' }`.
 *
 * Pattern reference: `validCreateBody(overrides)` in
 * `__tests__/api/items.test.ts` and `createMockMcpServer(overrides)` in
 * `__tests__/helpers/mcp-server.ts` — Liam-preferred `Partial<T>` overrides
 * convention per Test Philosophy §1 #6.
 */
import { vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createTestRequest } from '../mock-next';

/** Options accepted by `createMockFile()`. */
export interface MockFileOptions {
  /** File name (e.g. `tender.pdf`). Required. */
  name: string;
  /**
   * Byte contents. Either string (UTF-8 encoded), Uint8Array, or
   * undefined (defaults to empty bytes).
   */
  content?: string | Uint8Array;
  /**
   * MIME type. Defaults to `application/octet-stream` to mirror the DOM
   * `File` default for unknown extensions.
   */
  type?: string;
  /**
   * Explicit size override. If omitted, derived from `content` byte length.
   * Useful for size-validation tests that want a size without realistic
   * content (`size: 1024` with no content).
   */
  size?: number;
  /**
   * Construction strategy:
   * - `'prototype'` (default): `Object.create(File.prototype)` — required
   *   for tests asserting via `instanceof File` plus byte-accurate
   *   `arrayBuffer()`.
   * - `'plain'`: `new File([buffer], name, { type })` — JSDOM-friendly,
   *   used by component / hook tests.
   */
  construction?: 'prototype' | 'plain';
}

/**
 * Build a mock `File` for upload-route or upload-component tests.
 *
 * @param overrides Options — `name` is required. Other fields default.
 *
 * @example Api-route byte-accurate File (default)
 * ```ts
 * const file = createMockFile({
 *   name: 'tender.pdf',
 *   content: 'PDF bytes',
 *   type: 'application/pdf',
 * });
 * const req = createMockUploadRequest({ path: '/api/upload', file });
 * ```
 *
 * @example JSDOM-compatible plain File (component test)
 * ```ts
 * const file = createMockFile({
 *   name: 'tender.pdf',
 *   size: 1024,
 *   type: 'application/pdf',
 *   construction: 'plain',
 * });
 * ```
 */
export function createMockFile(overrides: MockFileOptions): File {
  const {
    name,
    content,
    type = 'application/octet-stream',
    size,
    construction = 'prototype',
  } = overrides;

  const bytes =
    typeof content === 'string'
      ? new TextEncoder().encode(content)
      : (content ?? new Uint8Array(size ?? 0));

  const finalSize = size ?? bytes.byteLength;

  if (construction === 'plain') {
    return new File([bytes as unknown as BlobPart], name, { type });
  }

  // `prototype` strategy: spoof File.prototype for `instanceof File` +
  // attach arrayBuffer() via a Blob backing.
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  return Object.create(File.prototype, {
    name: { value: name, writable: false, enumerable: true },
    type: { value: type, writable: false, enumerable: true },
    size: { value: finalSize, writable: false, enumerable: true },
    arrayBuffer: { value: () => blob.arrayBuffer(), writable: false },
  }) as File;
}

/** Options accepted by `createMockUploadRequest()`. */
export interface MockUploadRequestOptions {
  /** Path on `http://localhost:3000` (e.g. `/api/upload`). Required. */
  path: string;
  /**
   * The File to attach under the `file` field. Optional only when `files`
   * is provided (multi-file batch route); single-file routes pass this.
   */
  file?: File;
  /**
   * Extra FormData fields (e.g. `content_owner_id`, `skip_dedup`). Values
   * passed through to `formData.get(key)` as-is. `undefined` values are
   * dropped (i.e. the key returns `null` from `formData.get`).
   */
  fields?: Record<string, string | undefined>;
  /**
   * For batch-upload routes, an array of files attached under
   * `formData.getAll(filesKey)`. Defaults to the `'files[]'` key per
   * spec §5.2 (the ingest/markdown route convention).
   */
  files?: File[];
  /**
   * The FormData key under which `files[]` are attached. Defaults to
   * `'files[]'` — the canonical key per spec §5.2.
   */
  filesKey?: string;
  /** Phase field for the analyse/import batch routes. */
  phase?: string | null;
  /** Options JSON for the batch routes. */
  optionsJson?: string;
}

/**
 * Build a `NextRequest` with `formData()` pre-mocked. Files come through
 * `formData.get('file')` / `formData.getAll('files')`; overrides via
 * `formData.get(<key>)`.
 *
 * Canonical pattern: upload-route-owner.test.ts pre-S44 — overriding
 * `formData()` directly is the repo convention because vitest's jsdom
 * FormData has subtle differences from Node's `undici` FormData that
 * trip the api routes' boundary parsers.
 *
 * @example Single-file upload
 * ```ts
 * const file = createMockFile({ name: 'tender.pdf', content: 'pdf' });
 * const req = createMockUploadRequest({
 *   path: '/api/upload',
 *   file,
 *   fields: { content_owner_id: 'user-1' },
 * });
 * ```
 *
 * @example Batch upload (analyse phase)
 * ```ts
 * const req = createMockUploadRequest({
 *   path: '/api/ingest/markdown',
 *   file: files[0],
 *   files,
 *   phase: 'analyse',
 * });
 * ```
 */
export function createMockUploadRequest(
  overrides: MockUploadRequestOptions,
): NextRequest {
  const {
    path,
    file,
    fields = {},
    files,
    filesKey = 'files[]',
    phase,
    optionsJson,
  } = overrides;

  const req = createTestRequest(path, { method: 'POST', body: {} });

  const formData = new FormData();
  formData.get = vi.fn((key: string) => {
    if (key === 'file' && file !== undefined) return file;
    if (key === 'phase' && phase !== undefined) return phase;
    if (key === 'options' && optionsJson !== undefined) return optionsJson;
    const fieldValue = fields[key];
    if (fieldValue !== undefined) return fieldValue;
    return null;
  }) as unknown as typeof formData.get;

  if (files !== undefined) {
    formData.getAll = vi.fn((key: string) => {
      if (key === filesKey) return files as unknown as FormDataEntryValue[];
      return [];
    }) as unknown as typeof formData.getAll;
  }

  (req as unknown as { formData: () => Promise<FormData> }).formData = vi
    .fn()
    .mockResolvedValue(formData);

  return req;
}
