/**
 * Tests for ExportAuditPdfButton component.
 *
 * Verifies rendering, default date values, and download URL construction.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import ExportAuditPdfButton from '@/components/provenance/export-audit-pdf-button';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExportAuditPdfButton', () => {
  it('renders the export button and date inputs', () => {
    render(<ExportAuditPdfButton />);

    expect(screen.getByText('Export PDF')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('sets default from date to 30 days ago', () => {
    render(<ExportAuditPdfButton />);

    const fromInput = screen.getByLabelText('From') as HTMLInputElement;
    const expected = new Date();
    expected.setDate(expected.getDate() - 30);
    const expectedValue = expected.toISOString().slice(0, 10);

    expect(fromInput.value).toBe(expectedValue);
  });

  it('sets default to date to today', () => {
    render(<ExportAuditPdfButton />);

    const toInput = screen.getByLabelText('To') as HTMLInputElement;
    const expectedValue = new Date().toISOString().slice(0, 10);

    expect(toInput.value).toBe(expectedValue);
  });

  it('constructs correct download URL on click', () => {
    render(<ExportAuditPdfButton />);

    // Mock document.createElement to capture the anchor href
    const mockClick = vi.fn();
    const mockAnchor = {
      href: '',
      download: '',
      click: mockClick,
    };
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValueOnce(mockAnchor as unknown as HTMLElement);
    const appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node) => node);
    const removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation((node) => node);

    fireEvent.click(screen.getByText('Export PDF'));

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockAnchor.href).toContain(
      '/api/admin/provenance/export/verification-history?from=',
    );
    expect(mockClick).toHaveBeenCalled();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      expect.stringContaining('Export started'),
    );

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('updates date inputs when changed', () => {
    render(<ExportAuditPdfButton />);

    const fromInput = screen.getByLabelText('From') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-01-01' } });
    expect(fromInput.value).toBe('2026-01-01');

    const toInput = screen.getByLabelText('To') as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: '2026-02-01' } });
    expect(toInput.value).toBe('2026-02-01');
  });
});
