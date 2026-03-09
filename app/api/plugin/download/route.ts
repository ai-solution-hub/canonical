import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';

/**
 * GET /api/plugin/download
 *
 * Serves the Knowledge Hub plugin as a ZIP file for client installation.
 * Packages the plugin directory contents (commands, skills, plugin.json, etc.)
 * into a ZIP archive using the DecompressionStream-compatible format.
 *
 * Public route — no auth required (the plugin itself is not sensitive).
 */

// Files/directories to exclude from the ZIP
const EXCLUDED = new Set(['.DS_Store', 'node_modules', '.git']);

/**
 * Recursively collect all files in a directory, excluding unwanted files.
 */
async function collectFiles(
  dir: string,
  basePath: string,
): Promise<Array<{ path: string; content: Uint8Array }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; content: Uint8Array }> = [];

  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relativePath = relative(basePath, fullPath);

    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, basePath);
      files.push(...nested);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      files.push({ path: relativePath, content: new Uint8Array(content) });
    }
  }

  return files;
}

/**
 * Build a ZIP file from a list of file entries.
 * Uses the standard ZIP format (local file headers + central directory).
 */
function buildZip(files: Array<{ path: string; content: Uint8Array }>): Uint8Array {
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.path);
    const crc = crc32(file.content);

    // Local file header (30 bytes + name + content)
    const local = new Uint8Array(30 + nameBytes.length + file.content.length);
    const localView = new DataView(local.buffer);

    localView.setUint32(0, 0x04034b50, true); // Local file header signature
    localView.setUint16(4, 20, true); // Version needed
    localView.setUint16(6, 0, true); // Flags
    localView.setUint16(8, 0, true); // Compression (stored)
    localView.setUint16(10, 0, true); // Mod time
    localView.setUint16(12, 0, true); // Mod date
    localView.setUint32(14, crc, true); // CRC-32
    localView.setUint32(18, file.content.length, true); // Compressed size
    localView.setUint32(22, file.content.length, true); // Uncompressed size
    localView.setUint16(26, nameBytes.length, true); // Name length
    localView.setUint16(28, 0, true); // Extra field length

    local.set(nameBytes, 30);
    local.set(file.content, 30 + nameBytes.length);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);

    centralView.setUint32(0, 0x02014b50, true); // Central directory signature
    centralView.setUint16(4, 20, true); // Version made by
    centralView.setUint16(6, 20, true); // Version needed
    centralView.setUint16(8, 0, true); // Flags
    centralView.setUint16(10, 0, true); // Compression
    centralView.setUint16(12, 0, true); // Mod time
    centralView.setUint16(14, 0, true); // Mod date
    centralView.setUint32(16, crc, true); // CRC-32
    centralView.setUint32(20, file.content.length, true); // Compressed size
    centralView.setUint32(24, file.content.length, true); // Uncompressed size
    centralView.setUint16(28, nameBytes.length, true); // Name length
    centralView.setUint16(30, 0, true); // Extra field length
    centralView.setUint16(32, 0, true); // Comment length
    centralView.setUint16(34, 0, true); // Disk number
    centralView.setUint16(36, 0, true); // Internal attrs
    centralView.setUint32(38, 0, true); // External attrs
    centralView.setUint32(42, offset, true); // Relative offset

    central.set(nameBytes, 46);

    localHeaders.push(local);
    centralHeaders.push(central);
    offset += local.length;
  }

  // End of central directory record
  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true); // End signature
  endView.setUint16(4, 0, true); // Disk number
  endView.setUint16(6, 0, true); // Start disk
  endView.setUint16(8, files.length, true); // Entries on disk
  endView.setUint16(10, files.length, true); // Total entries
  endView.setUint32(12, centralDirSize, true); // Central dir size
  endView.setUint32(16, centralDirOffset, true); // Central dir offset
  endView.setUint16(20, 0, true); // Comment length

  // Concatenate all parts
  const totalSize = offset + centralDirSize + 22;
  const zip = new Uint8Array(totalSize);
  let pos = 0;

  for (const header of localHeaders) {
    zip.set(header, pos);
    pos += header.length;
  }
  for (const header of centralHeaders) {
    zip.set(header, pos);
    pos += header.length;
  }
  zip.set(endRecord, pos);

  return zip;
}

/**
 * CRC-32 implementation for ZIP file integrity.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function GET() {
  try {
    // Plugin directory relative to the project root
    const pluginDir = join(process.cwd(), '.claude', 'plugins', 'knowledge-hub', '1.0.0');

    // Verify directory exists
    try {
      await stat(pluginDir);
    } catch {
      return NextResponse.json(
        { error: 'Plugin not found' },
        { status: 404 },
      );
    }

    // Collect all files
    const files = await collectFiles(pluginDir, pluginDir);

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'Plugin directory is empty' },
        { status: 500 },
      );
    }

    // Build ZIP
    const zipData = buildZip(files);

    // Wrap Uint8Array in a ReadableStream for NextResponse compatibility
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(zipData);
        controller.close();
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="knowledge-hub-plugin.zip"',
        'Content-Length': String(zipData.length),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to build plugin ZIP: ${message}` },
      { status: 500 },
    );
  }
}
