/**
 * OrganiseSection — write error handling
 *
 * The section contains two write sites (addKeyword, removeKeyword). Both
 * use optimistic updates through `onKeywordsChanged`. On failure, the
 * rollback is called and telemetry fires with a distinct scope tag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockCaptureClientException } = vi.hoisted(() => ({
  mockCaptureClientException: vi.fn(),
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

vi.mock('@/components/workspace/workspace-selector', () => ({
  WorkspaceSelector: () => <div data-testid="workspace-selector" />,
}));

vi.mock('@/components/shared/user-tag-input', () => ({
  UserTagInput: () => <div data-testid="user-tag-input" />,
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { OrganiseSection } from '@/components/item-detail/organise-section';

describe('OrganiseSection — keyword write errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const defaultProps = {
    itemId: 'item-1',
    keywords: ['alpha', 'beta'],
    tags: [],
    workspaces: [],
    canEdit: true,
    onTagsChanged: vi.fn(),
    onWorkspacesChanged: vi.fn(),
  };

  it('reports removeKeyword telemetry and rolls back when the PATCH fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const onKeywordsChanged = vi.fn();

    render(
      <OrganiseSection
        {...defaultProps}
        onKeywordsChanged={onKeywordsChanged}
      />,
    );

    // Find the remove button on the "alpha" badge
    const alphaBadge = screen.getByText('alpha').closest('.group\\/kw');
    expect(alphaBadge).toBeTruthy();
    const removeBtn = within(alphaBadge as HTMLElement).getByRole('button', {
      name: /remove alpha/i,
    });
    await userEvent.click(removeBtn);

    await waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          scope: 'item-detail.organise-section.removeKeyword',
          extras: expect.objectContaining({
            itemId: 'item-1',
            keyword: 'alpha',
          }),
        }),
      );
    });

    // onKeywordsChanged called twice: once optimistically, once rollback
    expect(onKeywordsChanged).toHaveBeenCalledTimes(2);
    expect(onKeywordsChanged).toHaveBeenLastCalledWith(['alpha', 'beta']);
  });

  it('reports addKeyword telemetry and rolls back when the PATCH fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const onKeywordsChanged = vi.fn();

    render(
      <OrganiseSection
        {...defaultProps}
        onKeywordsChanged={onKeywordsChanged}
      />,
    );

    const input = screen.getByPlaceholderText(/add keyword/i);
    await userEvent.type(input, 'gamma{Enter}');

    await waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          scope: 'item-detail.organise-section.addKeyword',
          extras: expect.objectContaining({
            itemId: 'item-1',
            keyword: 'gamma',
          }),
        }),
      );
    });

    expect(onKeywordsChanged).toHaveBeenCalledTimes(2);
    expect(onKeywordsChanged).toHaveBeenLastCalledWith(['alpha', 'beta']);
  });
});
