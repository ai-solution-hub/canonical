/**
 * VENDORED from task-view @ v0.2.0-task-view (packages/server/atomic-write.ts).
 * Source of truth: https://github.com/liam-jons/task-view. Do NOT hand-edit the
 * body — re-vendor per lib/ledger/README.md when task-view cuts a new release.
 * Guarded by .github/workflows/task-view-vendor-drift.yml (ID-35.10).
 *
 * No schema imports — vendored byte-faithful (no rewire needed).
 *
 * ── original header ──────────────────────────────────────────────────────────
 * atomic-write.ts — TECH §5.3 atomic write-to-temp + POSIX rename.
 *
 * PRODUCT inv 36: all writes to the canonical JSON ledger are atomic —
 * a crashed write never produces a partial file.
 *
 * Implementation (TECH §5.3):
 *   1. Write content to a temp file in the SAME directory as the target.
 *   2. `fs.rename(tmp, target)` — POSIX `rename(2)` is atomic on the same
 *      filesystem (macOS APFS, Linux ext4/XFS/btrfs, Windows NTFS via Bun).
 *   3. On failure, the tmp file is best-effort cleaned up; the canonical
 *      file is left untouched.
 */

import { open, rename, rm, writeFile } from 'node:fs/promises';

/**
 * Write `content` to `targetPath` atomically.
 *
 * On success, the file at `targetPath` reflects the full content. On
 * failure (write error, rename error, etc.), the temp file is best-effort
 * removed and the original error is re-thrown. The canonical file at
 * `targetPath` is never partially written.
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string,
): Promise<void> {
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, targetPath);
  } catch (err) {
    try {
      await rm(tmp, { force: true });
    } catch {
      // Suppress.
    }
    throw err;
  }
}

// ── Two-phase staged write (ID-20.15 cross-ledger transaction) ─────────────────

/**
 * A staged write: content has been durably written + fsync'd to a temp
 * file next to its target, but the final rename has NOT happened. Call
 * {@link commitStagedWrite} to perform the rename (the atomic commit
 * point), or {@link abortStagedWrite} to discard the temp.
 */
export interface StagedWrite {
  /** Final destination path. */
  targetPath: string;
  /** The temp file holding the new content, fsync'd to disk. */
  tmpPath: string;
}

/**
 * Stage `content` for `targetPath`: write it to a temp file in the SAME
 * directory and `fsync` so the bytes are durable before any rename. The
 * canonical file is NOT touched.
 */
export async function stageAtomicWrite(
  targetPath: string,
  content: string,
): Promise<StagedWrite> {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}`;
  let handle;
  try {
    handle = await open(tmpPath, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } catch (err) {
    try {
      if (handle) await handle.close();
    } catch {
      // Suppress.
    }
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // Suppress.
    }
    throw err;
  }
  await handle.close();
  return { targetPath, tmpPath };
}

/**
 * Commit a staged write — the atomic commit point. POSIX `rename(2)` over
 * an existing file is atomic on the same filesystem.
 */
export async function commitStagedWrite(staged: StagedWrite): Promise<void> {
  await rename(staged.tmpPath, staged.targetPath);
}

/**
 * Abort a staged write — best-effort remove the temp file. Never throws.
 */
export async function abortStagedWrite(staged: StagedWrite): Promise<void> {
  try {
    await rm(staged.tmpPath, { force: true });
  } catch {
    // Suppress: aborting is best-effort; a leftover temp is harmless.
  }
}
