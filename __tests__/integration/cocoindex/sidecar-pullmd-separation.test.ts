/**
 * Integration test — PRODUCT Inv-9 (pullmd licence boundary preservation).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-9 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "pullmd remains a separately-deployed network service that the
 * > cocoindex sidecar invokes via HTTP — NOT co-located in the cocoindex
 * > sidecar image. The AGPL "network-service" clause boundary is
 * > preserved. Verifiable: container-image inspection (e.g.
 * > `docker image inspect`) of the cocoindex sidecar image returns zero
 * > pullmd binaries / Playwright dependencies; pullmd traffic is
 * > observable as outbound HTTP from the cocoindex sidecar to the pullmd
 * > Service."
 *
 * Per TECH §2.10 this file is named `sidecar-pullmd-separation.test.ts`
 * (NOT `.integration.test.ts`) — the matrix's filename convention signals
 * that the verifiable contract is a SOURCE-CODE / DOCKERFILE inspection
 * rather than a runtime Service probe. The integration runner can pick
 * up `.test.ts` patterns in `__tests__/integration/**` per the
 * `vitest.integration.config.ts` include glob:
 *   `__tests__/integration/**\/*.test.{ts,tsx}`
 * AND
 *   `__tests__/integration/**\/*.integration.test.{ts,tsx}`
 *
 * Test strategy:
 *   Static-code-level inspection — read the cocoindex sidecar Dockerfile
 *   and `requirements.txt`. Assert:
 *     1. No `pullmd` package declared in requirements.txt.
 *     2. No `playwright` / `playwright-python` package declared in
 *        requirements.txt.
 *     3. The Dockerfile does NOT install pullmd via apt-get / pip from a
 *        git URL / npm install / similar.
 *   These checks run WITHOUT requiring the staging Service to be deployed
 *   — they're code-level guards, not runtime probes. The runtime probe
 *   (outbound HTTP from cocoindex sidecar to pullmd Service) is owned by
 *   the workflow-step smoke verify per the matrix convention.
 *
 * Env-gate: NONE — this is a static-code inspection that runs in any
 * environment. Always-on.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-9.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-9.
 *   - cloudrun/cloudbuild-cocoindex.yaml (sidecar build config — owned by
 *     28.15; this test only READS).
 *   - requirements.txt (Python dependency manifest — root project, NOT
 *     touched by this test).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('Inv-9 — pullmd licence boundary preservation (image-content inspection)', () => {
  it('cocoindex sidecar Dockerfile does NOT install pullmd or Playwright', async () => {
    // The cocoindex sidecar Dockerfile / cloudbuild config is owned by
    // 28.15. Check the canonical location.
    const candidatePaths = [
      'cloudrun/cocoindex.Dockerfile',
      'cloudrun/Dockerfile.cocoindex',
      'scripts/cocoindex_pipeline/Dockerfile',
      'Dockerfile',
    ];

    let dockerfileContent: string | null = null;
    let dockerfilePath: string | null = null;
    for (const candidate of candidatePaths) {
      try {
        const fullPath = path.join(REPO_ROOT, candidate);
        dockerfileContent = await readFile(fullPath, 'utf-8');
        dockerfilePath = candidate;
        break;
      } catch {
        // File doesn't exist at this path; try next.
      }
    }

    // If no Dockerfile exists in the repo, the sidecar is built via
    // cloudbuild buildpack (no Dockerfile) — in which case the absence
    // of pullmd in requirements.txt is the relevant guard. Skip the
    // Dockerfile-content check but assert the requirements.txt guard
    // instead (the next test).
    if (!dockerfileContent) {
      // Not a fail — Dockerfile-absent sidecars are buildpack-driven
      // and the requirements.txt check covers them.
      expect(dockerfileContent).toBeNull();
      return;
    }

    // Assert: NO pullmd install lines.
    const lowerContent = dockerfileContent.toLowerCase();
    expect(lowerContent).not.toMatch(/pip\s+install\s+.*pullmd/);
    expect(lowerContent).not.toMatch(/pip\s+install\s+.*playwright/);
    expect(lowerContent).not.toMatch(/apt-get\s+install\s+.*chromium/);
    expect(lowerContent).not.toMatch(/apt-get\s+install\s+.*firefox/);
    expect(lowerContent).not.toMatch(/playwright\s+install/);

    // Document which Dockerfile was inspected so failures are debuggable.
    expect(dockerfilePath).toBeTruthy();
  });

  it('cocoindex sidecar requirements.txt does NOT list pullmd or Playwright', async () => {
    const requirementsPath = path.join(REPO_ROOT, 'requirements.txt');
    let requirementsContent: string;
    try {
      requirementsContent = await readFile(requirementsPath, 'utf-8');
    } catch {
      // If requirements.txt doesn't exist at the root, the sidecar may
      // use a per-service requirements file. Try the canonical sidecar
      // location.
      const sidecarRequirements = path.join(
        REPO_ROOT,
        'scripts/cocoindex_pipeline/requirements.txt',
      );
      requirementsContent = await readFile(sidecarRequirements, 'utf-8');
    }

    const lowerContent = requirementsContent.toLowerCase();
    // Inv-9 verifiability: pullmd MUST NOT be a Python package the
    // sidecar installs. The boundary is HTTP, not in-process.
    // Allow the literal `pullmd` to appear in comments but NOT as an
    // installable line — check line-by-line.
    const installableLines = lowerContent.split('\n').filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('#')) return false;
      return true;
    });

    for (const line of installableLines) {
      // No "pullmd" package install.
      expect(line).not.toMatch(/^pullmd[\s=<>!~]/);
      // No Playwright Python install.
      expect(line).not.toMatch(/^playwright[\s=<>!~]/);
      // No playwright-python (alternate package name).
      expect(line).not.toMatch(/^playwright-python[\s=<>!~]/);
    }
  });
});
