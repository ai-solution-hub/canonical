// {56.12} content_items ingest polling hook — Path B folder-drop async ingest
//
// After the folder-drop flow stages a file and triggers an incremental walk
// (see `lib/upload/folder-drop.ts`), cocoindex ingests the file asynchronously
// and writes a `content_items` row stamped with `source_file` = the dropped
// filename. This hook polls that correlation key until the row appears, then
// reports `ingested`.
//
// TanStack Query exclusively (CLAUDE.md): the poll is a `useQuery` with
// `refetchInterval`, gated on `enabled` (a non-null sourceFile + not-yet-
// terminal). The terminal transition is observed via the query result, not a
// cosmetic timer — this replaces the timer-driven illusion of progress with
// real backend state. Modelled on `components/create-content/
// upload-tab-content.tsx` (the markdown-batch poll loop) and
// `hooks/use-notifications.ts` (refetchInterval + stable empties).

'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchContentIngestStatus,
  type ContentIngestStatus,
} from '@/lib/query/fetchers';

/** Poll cadence (ms) — fast enough to feel live without hammering the API. */
const POLL_INTERVAL_MS = 2500;

/**
 * How long to keep polling before declaring a timeout. cocoindex ingest of a
 * single incremental file is typically well under a minute; 5 min is a generous
 * upper bound after which we surface a (recoverable) timeout rather than poll
 * forever.
 */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** Observable lifecycle of one folder-drop ingest. */
/** @public */
export type IngestPollStatus =
  | 'idle' // nothing being polled
  | 'pending' // staged + walk fired; waiting for the content_items row
  | 'ingested' // a content_items row appeared for this source_file
  | 'timeout' // gave up after POLL_TIMEOUT_MS with no row
  | 'error'; // the poll request itself errored

/** @public */
export interface UseContentIngestPollingResult {
  status: IngestPollStatus;
  /** The content_items id once ingested (null until then). */
  itemId: string | null;
  /** The source_file currently being polled (null when idle). */
  sourceFile: string | null;
  /** Begin polling for a freshly-staged file's content_items row. */
  start: (sourceFile: string) => void;
  /** Stop polling and return to idle. */
  reset: () => void;
}

/**
 * Poll `content_items` for a row matching `source_file` until it appears.
 *
 * Lifecycle: `start(sourceFile)` flips status to `pending` and begins the poll;
 * when the fetcher reports a matching row the status flips to `ingested` and
 * polling stops; if `POLL_TIMEOUT_MS` elapses with no row the status flips to
 * `timeout`; a thrown fetch error flips to `error`. `reset()` returns to idle.
 *
 * The hook does NOT swallow fetch errors silently — a query error surfaces as
 * `status: 'error'` (the fetcher's own 404-tolerance is the only soft path, and
 * that is a legitimate "row not landed yet" signal, not a failure).
 */
export function useContentIngestPolling(): UseContentIngestPollingResult {
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  // Deadline (epoch ms) after which polling stops and we report `timeout`.
  // Captured once at start() so render stays pure (no Date.now() in render).
  const [deadline, setDeadline] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  const start = useCallback((nextSourceFile: string) => {
    setSourceFile(nextSourceFile);
    setDeadline(Date.now() + POLL_TIMEOUT_MS);
    setTimedOut(false);
  }, []);

  const reset = useCallback(() => {
    setSourceFile(null);
    setDeadline(null);
    setTimedOut(false);
  }, []);

  const { data, isError } = useQuery<ContentIngestStatus>({
    queryKey: queryKeys.contentItems.ingestPoll(sourceFile ?? ''),
    queryFn: () => fetchContentIngestStatus(sourceFile as string),
    enabled: !!sourceFile && !timedOut,
    // refetchInterval runs outside render, so Date.now() is allowed here. Stop
    // polling once the row arrives or the deadline passes; flip the timeout flag
    // so the derived status surfaces it. Returning false halts the interval.
    refetchInterval: (query) => {
      if (query.state.data?.ingested) return false;
      if (deadline !== null && Date.now() > deadline) {
        setTimedOut(true);
        return false;
      }
      return POLL_INTERVAL_MS;
    },
  });

  const status: IngestPollStatus = useMemo(() => {
    if (!sourceFile) return 'idle';
    if (data?.ingested) return 'ingested';
    if (isError) return 'error';
    if (timedOut) return 'timeout';
    return 'pending';
  }, [sourceFile, data?.ingested, isError, timedOut]);

  return {
    status,
    itemId: data?.itemId ?? null,
    sourceFile,
    start,
    reset,
  };
}
