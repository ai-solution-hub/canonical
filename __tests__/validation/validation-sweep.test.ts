/**
 * Meta-test guard rail: ensures all API route files follow the centralised
 * validation pattern. Catches regressions where someone adds a new route
 * with raw parseInt/searchParams.get patterns instead of parseSearchParams.
 *
 * This is NOT a functional test -- it scans source files for anti-patterns.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const API_DIR = path.resolve(__dirname, '../../app/api');

/**
 * Recursively find all route.ts files under a directory.
 */
function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Routes that are exempt from validation import checks:
 * - Health checks, cron handlers, file upload endpoints, streaming endpoints,
 *   and routes with no user-supplied params.
 */
const EXEMPT_ROUTE_PATTERNS = [
  '/api/health/',
  '/api/cron/',
  '/api/mcp/',
  '/api/oauth/grants/', // Simple DELETE, no user input validation needed
  '/api/.well-known/',
  '/api/plugin/',
  '/api/jobs/',
  '/api/dashboard/', // No user-supplied params
  '/api/quality/summary/', // No user-supplied params
  '/api/search/suggestions/', // Simple GET
  '/api/change-reports/latest/', // No params
  '/api/content-owners/stats/', // No user-supplied params
  '/api/coverage/guides/', // No user-supplied params
  '/api/coverage/templates/list/', // No user-supplied params
  '/api/certifications/', // Simple GET/POST using parseBody
  '/api/freshness/recalculate-all/', // Cron-like endpoint
  '/api/reorient/', // No user-supplied params
  '/api/procurement/[id]/readiness/', // No user-supplied params
  '/api/procurement/[id]/templates/', // Simple GET
  '/api/procurement/[id]/responses/[rId]/history/', // Simple GET
  '/api/source-documents/[id]/versions/', // Simple GET
  '/api/source-documents/[id]/', // Uses parseBody already (check below catches it)
  '/api/items/[id]/files/', // File upload endpoint
  '/api/items/[id]/images/', // File upload endpoint
  '/api/items/[id]/history/[versionId]/', // Simple GET by ID
  '/api/items/[id]/layers/', // Uses parseBody
  '/api/notifications/', // Simple GET
  '/api/procurement/[id]/tender/', // File upload (POST), uses parseSearchParams (GET)
  '/api/procurement/[id]/templates/[templateId]/', // Simple GET/PATCH
  '/api/procurement/[id]/templates/[templateId]/completions/', // Download endpoint
  '/api/review/cadence/', // No user-supplied params
];

function isExempt(routePath: string): boolean {
  const relative = routePath.replace(API_DIR, '/api');
  // Normalise directory separators for cross-platform
  const normalised = relative.replace(/\\/g, '/');
  return EXEMPT_ROUTE_PATTERNS.some((pattern) => normalised.includes(pattern));
}

describe('validation sweep guard rail', () => {
  const routeFiles = findRouteFiles(API_DIR);

  it('should find route files in app/api/', () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  describe('no raw parseInt(searchParams.get( patterns', () => {
    // This regex catches the anti-pattern: parseInt(searchParams.get('...')
    const RAW_PARSEINT_RE = /parseInt\(\s*(?:searchParams|params)\.get\(/;

    for (const routeFile of routeFiles) {
      const relative = routeFile.replace(API_DIR, 'app/api');
      it(`${relative} should not use raw parseInt on search params`, () => {
        const content = fs.readFileSync(routeFile, 'utf-8');
        const matches = content.match(RAW_PARSEINT_RE);
        expect(
          matches,
          `Found raw parseInt(searchParams.get( in ${relative} -- use parseSearchParams instead`,
        ).toBeNull();
      });
    }
  });

  describe('no inline .safeParse() in route files', () => {
    // Routes should use parseBody/parseSearchParams, not call .safeParse() directly
    const SAFE_PARSE_RE = /\.safeParse\(/;

    for (const routeFile of routeFiles) {
      const relative = routeFile.replace(API_DIR, 'app/api');
      it(`${relative} should not use inline .safeParse()`, () => {
        const content = fs.readFileSync(routeFile, 'utf-8');
        const matches = content.match(SAFE_PARSE_RE);
        expect(
          matches,
          `Found inline .safeParse() in ${relative} -- use parseBody/parseSearchParams instead`,
        ).toBeNull();
      });
    }
  });

  describe('routes with request.json() or searchParams should import from @/lib/validation', () => {
    // Routes that handle POST/PATCH/PUT bodies or GET query params should
    // import parseBody or parseSearchParams from @/lib/validation.
    const BODY_PATTERN = /request\.json\(\)/;
    const SEARCH_PARAMS_PATTERN =
      /searchParams\.get\(|request\.nextUrl\.searchParams/;
    const VALIDATION_IMPORT = /@\/lib\/validation/;

    for (const routeFile of routeFiles) {
      if (isExempt(routeFile)) continue;

      const relative = routeFile.replace(API_DIR, 'app/api');
      const content = fs.readFileSync(routeFile, 'utf-8');
      const usesBody = BODY_PATTERN.test(content);
      const usesSearchParams = SEARCH_PARAMS_PATTERN.test(content);
      const importsValidation = VALIDATION_IMPORT.test(content);

      if (usesBody || usesSearchParams) {
        it(`${relative} should import from @/lib/validation`, () => {
          expect(
            importsValidation,
            `${relative} uses request.json() or searchParams but does not import from @/lib/validation`,
          ).toBe(true);
        });
      }
    }
  });
});
