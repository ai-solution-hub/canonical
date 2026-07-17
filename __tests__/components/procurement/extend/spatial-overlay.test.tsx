/**
 * ID-147.11 — SpatialOverlay: the reusable overlay primitive that renders
 * Extend `HighlightArea` boxes over `PdfDocument` (PRODUCT §C1-C4/§D1). It
 * takes geometry/HighlightArea as props — decoupled from the geometry
 * pipeline and from PdfDocument's internals — so both the §C fill-slot list
 * and the §D citations panel can drive it via `currentPage`/`goToPage`/a
 * shared `selectedId`.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SpatialOverlay } from '@/components/procurement/extend/spatial-overlay';
import {
  parseGeometry,
  geometryToHighlightArea,
} from '@/lib/domains/procurement/geometry-schema';

describe('SpatialOverlay — box placement (§C1/§D1, grounding §4a no y-flip)', () => {
  it('renders a box for a slot on the current page, positioned from its HighlightArea', () => {
    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'slot-1',
            page: 1,
            area: { left: 10, top: 20, width: 30, height: 5 },
            label: 'Applicant name',
          },
        ]}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    const box = screen.getByRole('button', { name: 'Applicant name' });
    const wrapper = box.parentElement as HTMLElement;

    expect(wrapper.style.left).toBe('10%');
    expect(wrapper.style.top).toBe('20%');
    expect(wrapper.style.width).toBe('30%');
    expect(wrapper.style.height).toBe('5%');
  });

  it('does not render a box for a slot on a different page', () => {
    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'slot-1',
            page: 2,
            area: { left: 10, top: 20, width: 30, height: 5 },
            label: 'Applicant name',
          },
        ]}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when there are no boxes for the current page', () => {
    const { container } = render(
      <SpatialOverlay
        boxes={[]}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('SpatialOverlay — never colour-only (§C2/§C3/§J4, WCAG 2.1 AA)', () => {
  it('carries a visible text label for the correspondence, not colour alone', () => {
    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'slot-1',
            page: 1,
            area: { left: 0, top: 0, width: 10, height: 10 },
            label: 'Unfilled — company registration number',
          },
        ]}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Unfilled — company registration number'),
    ).toBeInTheDocument();
  });

  it('marks the selected box via aria-pressed rather than colour alone', () => {
    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'a',
            page: 1,
            area: { left: 0, top: 0, width: 10, height: 10 },
            label: 'Field A',
          },
          {
            id: 'b',
            page: 1,
            area: { left: 20, top: 0, width: 10, height: 10 },
            label: 'Field B',
          },
        ]}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId="a"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Field A' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Field B' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('SpatialOverlay — bidirectional slot list <-> overlay linkage (§C2)', () => {
  it('selecting a box calls onSelect with its id (select box -> select item)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'slot-1',
            page: 1,
            area: { left: 0, top: 0, width: 10, height: 10 },
            label: 'Applicant name',
          },
        ]}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Applicant name' }));

    expect(onSelect).toHaveBeenCalledWith('slot-1');
  });

  it("navigates to the selected item's page via the goToPage prop (select item -> scroll/highlight box)", () => {
    const goToPage = vi.fn();

    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'slot-1',
            page: 3,
            area: { left: 0, top: 0, width: 10, height: 10 },
            label: 'Applicant name',
          },
        ]}
        currentPage={1}
        goToPage={goToPage}
        selectedId="slot-1"
        onSelect={vi.fn()}
      />,
    );

    expect(goToPage).toHaveBeenCalledWith(3);
  });

  it('does not navigate when the selected item is already on the current page', () => {
    const goToPage = vi.fn();

    render(
      <SpatialOverlay
        boxes={[
          {
            id: 'slot-1',
            page: 1,
            area: { left: 0, top: 0, width: 10, height: 10 },
            label: 'Applicant name',
          },
        ]}
        currentPage={1}
        goToPage={goToPage}
        selectedId="slot-1"
        onSelect={vi.fn()}
      />,
    );

    expect(goToPage).not.toHaveBeenCalled();
  });

  it('does not navigate when the selected id has no matching box', () => {
    const goToPage = vi.fn();

    render(
      <SpatialOverlay
        boxes={[]}
        currentPage={1}
        goToPage={goToPage}
        selectedId="unknown-id"
        onSelect={vi.fn()}
      />,
    );

    expect(goToPage).not.toHaveBeenCalled();
  });
});

describe('SpatialOverlay + geometrySchema — malformed geometry degrades to no box (§C4)', () => {
  it('omits a box whose persisted geometry fails validation, keeping valid boxes', () => {
    const rawFields = [
      {
        id: 'slot-valid',
        label: 'Applicant name',
        geometry: {
          left: 0.1,
          top: 0.2,
          width: 0.3,
          height: 0.05,
          page: 1,
          rotation: 0,
        },
      },
      {
        id: 'slot-malformed',
        label: 'Legacy field (table_index/row_index only, no geometry)',
        geometry: { table_index: 1, row_index: 2 },
      },
    ];

    const boxes = rawFields.flatMap((field) => {
      const geometry = parseGeometry(field.geometry);
      if (!geometry) return [];
      return [
        {
          id: field.id,
          page: geometry.page,
          area: geometryToHighlightArea(geometry),
          label: field.label,
        },
      ];
    });

    expect(boxes).toHaveLength(1);

    render(
      <SpatialOverlay
        boxes={boxes}
        currentPage={1}
        goToPage={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Applicant name' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Legacy field (table_index/row_index only, no geometry)',
      ),
    ).toBeNull();
  });
});
