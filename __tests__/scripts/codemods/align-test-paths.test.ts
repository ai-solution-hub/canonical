/**
 * `align-test-paths` codemod — classifier, subject discovery, and collision
 * detection.
 *
 * Subject discovery is exercised against in-memory source files so the cases
 * that matter (a mocked module must not be mistaken for the subject under test)
 * are pinned explicitly rather than inferred from the live tree.
 */
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import {
  derivePlan,
  detectCollisions,
  findSubjectModules,
  buildNeedsManualReport,
  type AlignPlanEntry,
} from '@/scripts/codemods/align-test-paths';

/** Build an in-memory source file so no disk fixture is needed. */
function sourceFileFrom(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile('__tests__/app/sample.test.ts', code);
}

describe('findSubjectModules — distinguishing the subject from its mocks', () => {
  it('treats a statically imported app module as the subject', () => {
    const sf = sourceFileFrom(`
      import { GET } from '@/app/api/health/route';
    `);
    expect(findSubjectModules(sf)).toEqual(['@/app/api/health/route']);
  });

  it('excludes a module that is only mocked, never imported', () => {
    // The regression this codemod exists to avoid: a regex prototype counted
    // the mocked module as a second subject and mis-routed the file.
    const sf = sourceFileFrom(`
      vi.mock('@/app/item/new/batch/batch-create-client', () => ({}));
      import { NewItemTabs } from '@/app/item/new/new-item-tabs';
    `);
    expect(findSubjectModules(sf)).toEqual(['@/app/item/new/new-item-tabs']);
  });

  it('excludes vi.doMock targets as well as vi.mock', () => {
    const sf = sourceFileFrom(`
      vi.doMock('@/app/api/other/route', () => ({}));
      import { POST } from '@/app/api/target/route';
    `);
    expect(findSubjectModules(sf)).toEqual(['@/app/api/target/route']);
  });

  it('counts dynamically imported app modules as subjects', () => {
    const sf = sourceFileFrom(`
      const { GET } = await import('@/app/api/deferred/route');
    `);
    expect(findSubjectModules(sf)).toEqual(['@/app/api/deferred/route']);
  });

  it('ignores non-app imports entirely', () => {
    const sf = sourceFileFrom(`
      import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';
      import { logger } from '@/lib/logger';
      import { GET } from '@/app/api/health/route';
    `);
    expect(findSubjectModules(sf)).toEqual(['@/app/api/health/route']);
  });

  it('returns nothing for a source-scanning guard with no imports', () => {
    const sf = sourceFileFrom(`
      import { readFileSync } from 'node:fs';
      const src = readFileSync('app/api/procurement/[id]/route.ts', 'utf8');
    `);
    expect(findSubjectModules(sf)).toEqual([]);
  });
});

describe('derivePlan — single subject', () => {
  it('reports a file already at its mirror path as OK', () => {
    const plan = derivePlan('__tests__/app/api/health/route.test.ts', [
      '@/app/api/health/route',
    ]);
    expect(plan.verdict).toBe('OK');
    expect(plan.target).toBeUndefined();
  });

  it('moves a flat route test into its full route path', () => {
    const plan = derivePlan(
      '__tests__/app/api/procurement/procurement-templates-fill.test.ts',
      ['@/app/api/procurement/[id]/templates/[templateId]/fill/route'],
    );
    expect(plan.verdict).toBe('MOVE');
    expect(plan.target).toBe(
      '__tests__/app/api/procurement/[id]/templates/[templateId]/fill/route.test.ts',
    );
  });

  it('restores bracket syntax on dynamic segments', () => {
    const plan = derivePlan(
      '__tests__/app/api/refinement/touchpoints/id/signals.test.ts',
      ['@/app/api/refinement/touchpoints/[id]/signals/route'],
    );
    expect(plan.target).toBe(
      '__tests__/app/api/refinement/touchpoints/[id]/signals/route.test.ts',
    );
  });

  it('renames in place when only the filename is wrong', () => {
    const plan = derivePlan('__tests__/app/api/health/health.test.ts', [
      '@/app/api/health/route',
    ]);
    expect(plan.verdict).toBe('RENAME');
    expect(plan.target).toBe('__tests__/app/api/health/route.test.ts');
  });

  it('accepts the dot-suffix aspect form as already correct', () => {
    // `layout.branding.test.tsx` must not be "corrected" to `layout.test.tsx`.
    const plan = derivePlan('__tests__/app/layout.branding.test.tsx', [
      '@/app/layout',
    ]);
    expect(plan.verdict).toBe('OK');
  });

  it('preserves an aspect suffix when relocating', () => {
    const plan = derivePlan('__tests__/app/page.mobile.test.tsx', [
      '@/app/procurement/[id]/page',
    ]);
    expect(plan.target).toBe(
      '__tests__/app/procurement/[id]/page.mobile.test.tsx',
    );
  });

  it('preserves the tsx extension for component tests', () => {
    const plan = derivePlan('__tests__/app/item/new-item-tabs.test.tsx', [
      '@/app/item/new/new-item-tabs',
    ]);
    expect(plan.target).toBe('__tests__/app/item/new/new-item-tabs.test.tsx');
  });

  it('converts a hyphen-suffixed aspect to dot form rather than dropping it', () => {
    // Flattening `page-mobile` to `page` would discard the fact that the file
    // covers the mobile viewport, and would then read as the canonical page
    // test for that route.
    const plan = derivePlan(
      '__tests__/app/procurement/[id]/session/page-mobile.test.tsx',
      ['@/app/procurement/[id]/session/page'],
    );
    expect(plan.target).toBe(
      '__tests__/app/procurement/[id]/session/page.mobile.test.tsx',
    );
  });

  it('does not mistake a hyphenated module name for an aspect', () => {
    // `source-documents-binary-url` shares no stem with the target `route`, so
    // the hyphen rule must not fire.
    const plan = derivePlan(
      '__tests__/app/api/source-documents/source-documents-binary-url.test.ts',
      ['@/app/api/source-documents/[id]/binary-url/route'],
    );
    expect(plan.target).toBe(
      '__tests__/app/api/source-documents/[id]/binary-url/route.test.ts',
    );
  });
});

describe('derivePlan — several subjects', () => {
  it('files an error/loading pair as the route folder boundaries test', () => {
    const plan = derivePlan('__tests__/app/settings-boundaries.test.tsx', [
      '@/app/settings/error',
      '@/app/settings/loading',
    ]);
    expect(plan.verdict).toBe('BOUNDARY');
    expect(plan.target).toBe('__tests__/app/settings/boundaries.test.tsx');
  });

  it('keeps root-level boundaries at the app root', () => {
    const plan = derivePlan('__tests__/app/root-boundaries.test.tsx', [
      '@/app/error',
      '@/app/loading',
    ]);
    expect(plan.target).toBe('__tests__/app/boundaries.test.tsx');
  });

  it('files a test spanning unrelated routes as cross-cutting', () => {
    const plan = derivePlan('__tests__/app/api/oauth/auth.test.ts', [
      '@/app/api/admin/users/route',
      '@/app/api/health/route',
      '@/app/api/review/action/route',
    ]);
    expect(plan.verdict).toBe('CROSS_CUTTING');
    expect(plan.target).toBe('__tests__/app/api/_cross-cutting/auth.test.ts');
  });

  it('escalates a multi-route file under one real route dir for naming', () => {
    const plan = derivePlan('__tests__/app/api/intelligence/sources.test.ts', [
      '@/app/api/intelligence/workspaces/[id]/sources/[sourceId]/route',
      '@/app/api/intelligence/workspaces/[id]/sources/route',
    ]);
    expect(plan.verdict).toBe('MANUAL');
    expect(plan.reason).toBe('MULTI_SUBJECT_NAME');
  });
});

describe('derivePlan — escalations', () => {
  it('escalates a file with no app import', () => {
    const plan = derivePlan(
      '__tests__/app/api/procurement/procurement-form-reanchor-guard.test.ts',
      [],
    );
    expect(plan.verdict).toBe('MANUAL');
    expect(plan.reason).toBe('NO_SUBJECT_IMPORT');
  });

  it('refuses to relocate a catch-all bucket that needs splitting', () => {
    const plan = derivePlan('__tests__/app/api/remaining-routes.test.ts', [
      '@/app/api/guides/[slug]/sections/[sectionId]/route',
      '@/app/api/oauth/decision/route',
    ]);
    expect(plan.verdict).toBe('MANUAL');
    expect(plan.reason).toBe('NEEDS_CONTENT_SPLIT');
    expect(plan.target).toBeUndefined();
  });
});

describe('detectCollisions', () => {
  const planFor = (source: string, target: string): AlignPlanEntry => ({
    source,
    target,
    verdict: 'MOVE',
    subjects: ['@/app/api/x/route'],
  });

  it('escalates both files when two sources claim one target', () => {
    const result = detectCollisions(
      [
        planFor('__tests__/app/api/review/history.test.ts', 'T.test.ts'),
        planFor('__tests__/app/api/review/review-history.test.ts', 'T.test.ts'),
      ],
      () => false,
    );
    expect(result.map((r) => r.verdict)).toEqual(['MANUAL', 'MANUAL']);
    expect(result[0].reason).toBe('COLLISION_NEEDS_ASPECT');
  });

  it('escalates when the target already exists on disk', () => {
    const result = detectCollisions(
      [planFor('__tests__/app/api/q-a-pairs/route.test.ts', 'taken.test.ts')],
      (rel) => rel === 'taken.test.ts',
    );
    expect(result[0].verdict).toBe('MANUAL');
    expect(result[0].reason).toBe('TARGET_EXISTS');
  });

  it('leaves an uncontested move mechanisable', () => {
    const result = detectCollisions(
      [planFor('__tests__/app/api/a.test.ts', 'free.test.ts')],
      () => false,
    );
    expect(result[0].verdict).toBe('MOVE');
    expect(result[0].reason).toBeUndefined();
  });

  it('does not treat a file already at its target as a collision', () => {
    const result = detectCollisions(
      [planFor('same.test.ts', 'same.test.ts')],
      (rel) => rel === 'same.test.ts',
    );
    expect(result[0].verdict).toBe('MOVE');
  });
});

describe('buildNeedsManualReport', () => {
  it('reports only escalated files, carrying reason and subjects', () => {
    const report = buildNeedsManualReport([
      { source: 'ok.test.ts', verdict: 'OK', subjects: ['@/app/a'] },
      {
        source: 'manual.test.ts',
        verdict: 'MANUAL',
        reason: 'NO_SUBJECT_IMPORT',
        subjects: [],
      },
    ]);
    expect(report).toEqual([
      { file: 'manual.test.ts', reason: 'NO_SUBJECT_IMPORT', subjects: [] },
    ]);
  });
});
