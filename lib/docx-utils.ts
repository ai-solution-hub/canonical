/**
 * Utilities for validating .docx files before processing.
 *
 * Encrypted (password-protected) Office documents use OLE2 Compound Document
 * format (MS-CFB) instead of the standard ZIP container, or wrap the real
 * content inside an `EncryptedPackage` ZIP entry. Both cases cause downstream
 * failures — detect them early and return a clear error.
 */

/** OLE2 Compound Document magic bytes (D0 CF 11 E0 A1 B1 1A E1). */
const OLE2_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** ZIP local file header magic bytes (PK\x03\x04). */
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/**
 * Check whether a buffer represents an encrypted (password-protected) .docx.
 *
 * Detection strategy:
 *  1. If the first 8 bytes match the OLE2/MS-CFB signature the file is
 *     encrypted — Office wraps password-protected documents in a CFB envelope.
 *  2. If the file is a ZIP archive (normal .docx), scan the local file headers
 *     for an entry named `EncryptedPackage` which indicates an encrypted
 *     document stored inside a ZIP wrapper.
 *
 * @param buffer  Raw file content (ArrayBuffer or Buffer).
 * @returns `true` when the document appears to be password-protected.
 */
export function isEncryptedDocx(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 8) return false;

  // 1. OLE2 / MS-CFB envelope — always means encrypted for a .docx upload
  if (matchesBytes(bytes, OLE2_MAGIC, 0)) {
    return true;
  }

  // 2. ZIP container — scan local file headers for EncryptedPackage entry
  if (matchesBytes(bytes, ZIP_MAGIC, 0)) {
    return zipContainsEncryptedPackage(bytes);
  }

  return false;
}

// ── internal helpers ────────────────────────────────────────────────

function matchesBytes(
  data: Uint8Array,
  signature: Uint8Array,
  offset: number,
): boolean {
  if (data.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (data[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Walk local file headers in a ZIP archive looking for an entry whose
 * filename is exactly `EncryptedPackage`.
 *
 * ZIP local file header layout (from offset 0 of each header):
 *   0-3   : signature  PK\x03\x04
 *   4-5   : version needed
 *   6-7   : general purpose bit flag
 *   8-9   : compression method
 *   10-13 : mod time / date
 *   14-17 : crc-32
 *   18-21 : compressed size
 *   22-25 : uncompressed size
 *   26-27 : filename length
 *   28-29 : extra field length
 *   30+   : filename (variable length)
 */
function zipContainsEncryptedPackage(data: Uint8Array): boolean {
  const target = 'EncryptedPackage';
  let offset = 0;

  // Safety: cap iterations to avoid runaway loops on malformed archives
  const maxEntries = 500;
  let entries = 0;

  while (offset + 30 <= data.length && entries < maxEntries) {
    // Must start with local file header signature
    if (!matchesBytes(data, ZIP_MAGIC, offset)) break;

    const filenameLength = data[offset + 26] | (data[offset + 27] << 8);
    const extraFieldLength = data[offset + 28] | (data[offset + 29] << 8);

    // Read the filename
    const filenameStart = offset + 30;
    const filenameEnd = filenameStart + filenameLength;
    if (filenameEnd > data.length) break;

    const filename = new TextDecoder().decode(data.slice(filenameStart, filenameEnd));
    if (filename === target) return true;

    // Check data descriptor flag (bit 3 of general purpose flags at offset 6)
    const flags = data[offset + 6] | (data[offset + 7] << 8);
    const hasDataDescriptor = (flags & 0x08) !== 0;

    // Read compressed size to jump to the next header
    const compressedSize =
      data[offset + 18] |
      (data[offset + 19] << 8) |
      (data[offset + 20] << 16) |
      (data[offset + 21] << 24);

    // When data descriptor flag is set, compressedSize may be 0 in the
    // local header — scan forward for the next PK signature instead
    if (hasDataDescriptor && compressedSize === 0) {
      let scanOffset = filenameEnd + extraFieldLength;
      let found = false;
      while (scanOffset + 4 <= data.length) {
        if (matchesBytes(data, ZIP_MAGIC, scanOffset)) {
          offset = scanOffset;
          found = true;
          break;
        }
        scanOffset++;
      }
      if (!found) break;
    } else {
      // Advance past this entry: header (30) + filename + extra + data
      offset = filenameEnd + extraFieldLength + (compressedSize >>> 0);
    }
    entries++;
  }

  return false;
}
