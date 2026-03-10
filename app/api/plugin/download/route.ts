import { NextResponse } from 'next/server';

/**
 * GET /api/plugin/download
 *
 * Serves the Knowledge Hub plugin as a ZIP file for client installation.
 * Uses a pre-built ZIP bundle (base64 string constant) so this works on
 * Vercel serverless where the .claude/ directory is not deployed.
 *
 * Public route — no auth required (the plugin itself is not sensitive).
 *
 * Regenerate the bundle: bun run build:plugin
 */
export async function GET() {
  try {
    // Lazy import to keep the ~110 KB base64 string out of module evaluation
    const { PLUGIN_ZIP_BASE64, PLUGIN_ZIP_SIZE } = await import('@/lib/mcp/plugin-bundle');

    const zipData = Buffer.from(PLUGIN_ZIP_BASE64, 'base64');

    return new NextResponse(zipData, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="knowledge-hub-plugin.zip"',
        'Content-Length': String(PLUGIN_ZIP_SIZE),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to serve plugin ZIP: ${message}` },
      { status: 500 },
    );
  }
}
