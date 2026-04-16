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
  UrlIngestForm: () => <div data-testid="url-ingest-form" />,
}));

vi.mock('@/components/create-content/upload-tab-content', () => ({
  UploadTabContent: () => <div data-testid="upload-tab-content" />,
}));

vi.mock('@/components/create-content/file-upload-dialog', () => ({
  FileUploadDialog: () => null,
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

    expect(screen.getByRole('tab', { name: /write content/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /import from url/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /upload file/i })).toBeInTheDocument();
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
});
