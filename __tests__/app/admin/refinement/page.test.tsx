/**
 * /admin/refinement — graduation-metric cell rendering (ID-104.18 + ID-104 close).
 *
 * Locks the {104} code-simplification decision (nit d): a touchpoint that
 * DECLARES a graduation_metric but whose value cannot be read — the B-INV-19
 * "declared but unreadable" loud-fail mode the runner exits 2 on — is surfaced
 * DISTINCTLY ('err', text-destructive, its own aria-label), NOT collapsed into
 * the same dash as a touchpoint that declares no metric at all. Three states:
 * value → percentage; declared-but-unreadable → 'err'; undeclared → dash.
 *
 * Spec: specs/id-104-eval-engine/TECH.md §T19, PRODUCT.md §B-INV-19.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth', () => ({
  getAuthorisedClient: vi.fn().mockResolvedValue({
    success: true,
    // Minimal chainable — the signal-count query is built here but executed by
    // the mocked tryQuery (which ignores its argument), so it only needs to not throw.
    supabase: { from: () => ({ select: () => ({}) }) },
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// Three registered touchpoints: one with a readable metric, one whose declared
// metric is unreadable (metricFor throws), one with no declared metric.
vi.mock('@/lib/eval/registry', () => ({
  listTouchpoints: vi.fn().mockResolvedValue([
    {
      touchpoint_id: 'tp-ok',
      kind: 'tool',
      owner: 'platform',
      suite_name: 'l3',
      contract_version: 1,
      registry_version: 1,
      graduation_metric: 'win_rate',
    },
    {
      touchpoint_id: 'tp-unreadable',
      kind: 'tool',
      owner: 'platform',
      suite_name: 'l3',
      contract_version: 1,
      registry_version: 1,
      graduation_metric: 'progressive_trust',
    },
    {
      touchpoint_id: 'tp-none',
      kind: 'tool',
      owner: 'platform',
      suite_name: 'l1',
      contract_version: 1,
      registry_version: 1,
      graduation_metric: null,
    },
  ]),
}));

vi.mock('@/lib/eval/graduation', () => ({
  // tp-ok resolves a value; the declared tp-unreadable throws (B-INV-19 loud-fail).
  metricFor: vi.fn(async (_supabase: unknown, touchpointId: string) => {
    if (touchpointId === 'tp-ok') {
      return {
        touchpoint_id: 'tp-ok',
        metric: 'win_rate',
        value: 0.75,
        sample_size: 12,
        computed_in_house: true,
      };
    }
    throw new Error('unknown graduation metric "progressive_trust"');
  }),
}));

vi.mock('@/lib/supabase/safe', () => ({
  tryQuery: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}));

import AdminRefinementPage from '@/app/admin/refinement/page';

describe('/admin/refinement — graduation metric cell (nit d, B-INV-19)', () => {
  it('renders a readable metric as a percentage', async () => {
    render(await AdminRefinementPage());
    expect(screen.getByText('75.0%')).toBeInTheDocument();
  });

  it('renders a declared-but-unreadable metric distinctly (err), not as the no-declaration dash', async () => {
    render(await AdminRefinementPage());
    // Distinct token + distinct aria-label — the B-INV-19 declared-but-unreadable state.
    expect(screen.getByText('err')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Declared graduation metric is unreadable'),
    ).toBeInTheDocument();
  });

  it('renders an undeclared metric as the muted dash, distinct from the unreadable token', async () => {
    render(await AdminRefinementPage());
    expect(
      screen.getByLabelText('No graduation metric declared'),
    ).toBeInTheDocument();
    // The two states do not share a label — declared-but-unreadable is not silently
    // identical to no-declaration.
    expect(screen.queryByLabelText('No graduation metric declared')).not.toBe(
      screen.queryByLabelText('Declared graduation metric is unreadable'),
    );
  });
});
