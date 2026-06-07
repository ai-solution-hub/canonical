/**
 * NearDuplicatesMergeDirectionDialog Component Tests
 *
 * Verifies the spec §6.2 default-direction heuristic + the radio toggle
 * + the oldId/newId derivation passed to onConfirm.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import {
  NearDuplicatesMergeDirectionDialog,
  defaultMergeDirection,
} from '@/components/admin/content-dedup/near-duplicates/near-duplicates-merge-direction-dialog';
import type { NearDupPairMember } from '@/lib/query/fetchers';

const LEFT_ID = '11111111-1111-4111-8111-111111111111';
const RIGHT_ID = '22222222-2222-4222-8222-222222222222';

function makeMember(
  overrides: Partial<NearDupPairMember> = {},
): NearDupPairMember {
  return {
    id: LEFT_ID,
    title: 'A row',
    content: 'body',
    dedup_status: 'clean',
    created_at: '2026-04-21T12:00:00Z',
    primary_domain: 'access-control',
    content_type: 'q_a_pair',
    content_owner_id: null,
    ingest_source: 'example-reingest-2026-v2',
    superseded_by: null,
    archived_at: null,
    publication_status: 'in_review',
    ...overrides,
  };
}

describe('defaultMergeDirection (heuristic)', () => {
  it('identical statuses → newer (left) wins', () => {
    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'in_review',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-03-14T12:00:00Z',
      publication_status: 'in_review',
    });

    expect(defaultMergeDirection(left, right)).toBe('left-supersedes-right');
  });

  it('identical statuses → newer (right) wins', () => {
    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-03-14T12:00:00Z',
      publication_status: 'in_review',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'in_review',
    });

    expect(defaultMergeDirection(left, right)).toBe('right-supersedes-left');
  });

  it('left published > right not-published → left wins regardless of date', () => {
    const left = makeMember({
      id: LEFT_ID,
      // Older, but published.
      created_at: '2026-01-01T12:00:00Z',
      publication_status: 'published',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'in_review',
    });

    expect(defaultMergeDirection(left, right)).toBe('left-supersedes-right');
  });

  it('right published > left not-published → right wins regardless of date', () => {
    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'in_review',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-01-01T12:00:00Z',
      publication_status: 'published',
    });

    expect(defaultMergeDirection(left, right)).toBe('right-supersedes-left');
  });

  it('neither published → newer wins', () => {
    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'draft',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-01-01T12:00:00Z',
      publication_status: 'in_review',
    });

    expect(defaultMergeDirection(left, right)).toBe('left-supersedes-right');
  });
});

describe('NearDuplicatesMergeDirectionDialog', () => {
  beforeEach(() => {
    installRadixPointerShims();
  });

  it('opens with the heuristic default checked (identical-status, newer-left)', () => {
    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-03-14T12:00:00Z',
    });

    render(
      <NearDuplicatesMergeDirectionDialog
        open
        onOpenChange={() => {}}
        left={left}
        right={right}
        isPending={false}
        onConfirm={() => {}}
      />,
    );

    expect(
      screen.getByTestId('merge-direction-left-supersedes-right'),
    ).toBeChecked();
    expect(
      screen.getByTestId('merge-direction-right-supersedes-left'),
    ).not.toBeChecked();
  });

  it('confirms with oldId=right, newId=left when default direction is left-supersedes-right', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'published',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-03-14T12:00:00Z',
      publication_status: 'in_review',
    });

    render(
      <NearDuplicatesMergeDirectionDialog
        open
        onOpenChange={() => {}}
        left={left}
        right={right}
        note="manual"
        isPending={false}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByTestId('merge-direction-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({
      oldId: RIGHT_ID,
      newId: LEFT_ID,
      note: 'manual',
    });
  });

  it('confirms with reversed ids after toggling the radio', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'published',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-03-14T12:00:00Z',
      publication_status: 'in_review',
    });

    render(
      <NearDuplicatesMergeDirectionDialog
        open
        onOpenChange={() => {}}
        left={left}
        right={right}
        isPending={false}
        onConfirm={onConfirm}
      />,
    );

    await user.click(
      screen.getByTestId('merge-direction-right-supersedes-left'),
    );
    await user.click(screen.getByTestId('merge-direction-confirm'));

    expect(onConfirm).toHaveBeenCalledWith({
      oldId: LEFT_ID,
      newId: RIGHT_ID,
      note: undefined,
    });
  });

  it('disables Confirm + Cancel while a merge mutation is pending', () => {
    render(
      <NearDuplicatesMergeDirectionDialog
        open
        onOpenChange={() => {}}
        left={makeMember({ id: LEFT_ID })}
        right={makeMember({ id: RIGHT_ID })}
        isPending
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByTestId('merge-direction-confirm')).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });
});
