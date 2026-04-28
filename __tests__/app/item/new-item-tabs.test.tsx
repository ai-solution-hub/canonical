/**
 * NewItemTabs — defaultTab + tab rendering tests
 *
 * Verifies that the NewItemTabs component:
 * - Renders all four tabs (Write, URL, Upload, Batch Q&A)
 * - Respects the defaultTab prop for initial tab selection
 * - Renders the correct content for the selected tab
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks — must mock child components to avoid their internal dependencies
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/item/new',
}));

vi.mock('@/app/item/new/create-content-client', () => ({
  CreateContentClient: () => <div data-testid="create-content-client" />,
}));

vi.mock('@/components/create-content/url-ingest-form', () => ({
  UrlIngestForm: ({ onSuggestManual }: { onSuggestManual?: () => void }) => (
    <div data-testid="url-ingest-form">
      {onSuggestManual && (
        <button data-testid="url-suggest-manual" onClick={onSuggestManual}>
          Suggest manual
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/create-content/upload-tab-content', () => ({
  UploadTabContent: ({
    onSwitchTab,
  }: {
    onSwitchTab?: (tab: string) => void;
  }) => (
    <div data-testid="upload-tab-content">
      {onSwitchTab && (
        <>
          <button
            data-testid="upload-switch-url"
            onClick={() => onSwitchTab('url')}
          >
            Try URL instead
          </button>
          <button
            data-testid="upload-switch-write"
            onClick={() => onSwitchTab('write')}
          >
            Write manually
          </button>
        </>
      )}
    </div>
  ),
}));

vi.mock('@/app/item/new/batch/batch-create-client', () => ({
  BatchCreateContent: () => <div data-testid="batch-create-content" />,
}));

import { NewItemTabs } from '@/app/item/new/new-item-tabs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewItemTabs', () => {
  it('renders all four tab triggers', () => {
    render(<NewItemTabs />);

    expect(
      screen.getByRole('tab', { name: /write content/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /import from url/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /upload file/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /batch q&a/i })).toBeInTheDocument();
  });

  it('defaults to write tab when no defaultTab prop', () => {
    render(<NewItemTabs />);

    const writeTab = screen.getByRole('tab', { name: /write content/i });
    expect(writeTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('create-content-client')).toBeInTheDocument();
  });

  it('activates batch tab when defaultTab="batch"', () => {
    render(<NewItemTabs defaultTab="batch" />);

    const batchTab = screen.getByRole('tab', { name: /batch q&a/i });
    expect(batchTab).toHaveAttribute('data-state', 'active');
  });

  it('activates upload tab when defaultTab="upload"', () => {
    render(<NewItemTabs defaultTab="upload" />);

    const uploadTab = screen.getByRole('tab', { name: /upload file/i });
    expect(uploadTab).toHaveAttribute('data-state', 'active');
  });

  it('activates url tab when defaultTab="url"', () => {
    render(<NewItemTabs defaultTab="url" />);

    const urlTab = screen.getByRole('tab', { name: /import from url/i });
    expect(urlTab).toHaveAttribute('data-state', 'active');
  });

  it('renders BatchCreateContent when batch tab is active', () => {
    render(<NewItemTabs defaultTab="batch" />);

    expect(screen.getByTestId('batch-create-content')).toBeInTheDocument();
  });

  it('falls back to write tab when defaultTab is an invalid value', () => {
    // @ts-expect-error — deliberately passing an invalid prop to test runtime guard
    render(<NewItemTabs defaultTab="garbage" />);

    const writeTab = screen.getByRole('tab', { name: /write content/i });
    expect(writeTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('create-content-client')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Tab switching
  // ---------------------------------------------------------------------------

  it('clicking a tab switches the active tab', async () => {
    const user = userEvent.setup();
    render(<NewItemTabs />);

    // Default is write
    expect(screen.getByRole('tab', { name: /write content/i })).toHaveAttribute(
      'data-state',
      'active',
    );

    // Click URL tab
    await user.click(screen.getByRole('tab', { name: /import from url/i }));

    expect(
      screen.getByRole('tab', { name: /import from url/i }),
    ).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: /write content/i })).toHaveAttribute(
      'data-state',
      'inactive',
    );
    expect(screen.getByTestId('url-ingest-form')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Cross-method suggestions
  // ---------------------------------------------------------------------------

  it('"Have a file instead? Upload it" switches to upload tab', async () => {
    const user = userEvent.setup();
    render(<NewItemTabs />);

    // The cross-method suggestion is inside the write tab
    const uploadSuggestion = screen.getByRole('button', {
      name: /upload it/i,
    });
    await user.click(uploadSuggestion);

    expect(screen.getByRole('tab', { name: /upload file/i })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.getByTestId('upload-tab-content')).toBeInTheDocument();
  });

  it('UrlIngestForm onSuggestManual switches back to write tab', async () => {
    const user = userEvent.setup();
    render(<NewItemTabs defaultTab="url" />);

    // URL tab is active
    expect(
      screen.getByRole('tab', { name: /import from url/i }),
    ).toHaveAttribute('data-state', 'active');

    // Click the mock suggest-manual button
    await user.click(screen.getByTestId('url-suggest-manual'));

    expect(screen.getByRole('tab', { name: /write content/i })).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(screen.getByTestId('create-content-client')).toBeInTheDocument();
  });

  it('UploadTabContent onSwitchTab("url") switches to URL tab', async () => {
    const user = userEvent.setup();
    render(<NewItemTabs defaultTab="upload" />);

    // Upload tab is active
    expect(screen.getByRole('tab', { name: /upload file/i })).toHaveAttribute(
      'data-state',
      'active',
    );

    // Click the mock switch-to-url button
    await user.click(screen.getByTestId('upload-switch-url'));

    expect(
      screen.getByRole('tab', { name: /import from url/i }),
    ).toHaveAttribute('data-state', 'active');
  });

  it('UploadTabContent onSwitchTab("write") switches to write tab', async () => {
    const user = userEvent.setup();
    render(<NewItemTabs defaultTab="upload" />);

    // Click the mock switch-to-write button
    await user.click(screen.getByTestId('upload-switch-write'));

    expect(screen.getByRole('tab', { name: /write content/i })).toHaveAttribute(
      'data-state',
      'active',
    );
  });
});
