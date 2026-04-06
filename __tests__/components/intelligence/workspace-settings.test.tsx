/**
 * WorkspaceSettings Component Tests (SI-L5)
 *
 * Tests the relevance-threshold slider:
 *   - Loads persisted threshold from workspace.domain_metadata
 *   - Defaults to 0.50 when unset
 *   - Save → mutation invocation with correct payload
 *   - Reset restores persisted value
 *   - Editor view is read-only (no save button, slider disabled)
 *   - Loading state renders skeleton
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUseIntelligenceWorkspace, mockMutate, mockUseUserRole } =
  vi.hoisted(() => ({
    mockUseIntelligenceWorkspace: vi.fn(),
    mockMutate: vi.fn(),
    mockUseUserRole: vi.fn(),
  }));

vi.mock('@/hooks/intelligence/use-intelligence-workspaces', () => ({
  useIntelligenceWorkspace: (id: string) => mockUseIntelligenceWorkspace(id),
  useUpdateIntelligenceWorkspace: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import AFTER mocks
import { WorkspaceSettings } from '@/components/intelligence/workspace-settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function buildWorkspace(thresholdValue?: number) {
  return {
    id: VALID_UUID,
    name: 'Education Watch',
    description: null,
    type: 'intelligence' as const,
    domain_metadata: {
      company_profile_id: 'profile-1',
      ...(thresholdValue !== undefined && {
        relevance_threshold: thresholdValue,
      }),
    },
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function configureAdmin() {
  mockUseUserRole.mockReturnValue({
    role: 'admin',
    canEdit: true,
    canAdmin: true,
    loading: false,
  });
}

function configureEditor() {
  mockUseUserRole.mockReturnValue({
    role: 'editor',
    canEdit: true,
    canAdmin: false,
    loading: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceSettings — relevance threshold slider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('admin view', () => {
    beforeEach(() => {
      configureAdmin();
    });

    it('shows skeleton while loading', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: null,
        isLoading: true,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      expect(
        screen.getByLabelText('Loading workspace settings'),
      ).toBeInTheDocument();
    });

    it('defaults the slider to 0.50 when no threshold is persisted', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      expect(slider).toBeInTheDocument();
      expect(slider.value).toBe('0.5');
      expect(screen.getByText('0.50')).toBeInTheDocument();
    });

    it('loads the persisted threshold when present', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.75),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      expect(slider.value).toBe('0.75');
      expect(screen.getByText('0.75')).toBeInTheDocument();
    });

    it('updates the displayed value as the slider moves', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.5),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '0.8' } });
      expect(slider.value).toBe('0.8');
      expect(screen.getByText('0.80')).toBeInTheDocument();
    });

    it('disables Save and Reset until the slider is dirty', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.5),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const saveButton = screen.getByRole('button', {
        name: /save threshold/i,
      });
      const resetButton = screen.getByRole('button', { name: /reset/i });
      expect(saveButton).toBeDisabled();
      expect(resetButton).toBeDisabled();
    });

    it('enables Save once the slider value diverges from the persisted value', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.5),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '0.7' } });

      const saveButton = screen.getByRole('button', {
        name: /save threshold/i,
      });
      expect(saveButton).not.toBeDisabled();
    });

    it('calls the mutation with the new threshold on Save', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.5),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '0.65' } });

      const saveButton = screen.getByRole('button', {
        name: /save threshold/i,
      });
      fireEvent.click(saveButton);

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate).toHaveBeenCalledWith({
        relevance_threshold: 0.65,
      });
    });

    it('Reset restores the persisted value and re-disables Save', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.5),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '0.8' } });

      const resetButton = screen.getByRole('button', { name: /reset/i });
      expect(resetButton).not.toBeDisabled();
      fireEvent.click(resetButton);

      expect(slider.value).toBe('0.5');
      const saveButton = screen.getByRole('button', {
        name: /save threshold/i,
      });
      expect(saveButton).toBeDisabled();
    });

    it('renders helper text describing the threshold semantics', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      expect(
        screen.getByText(/Articles scoring below this threshold/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Lower = more articles/i)).toBeInTheDocument();
    });
  });

  describe('non-admin (editor) view', () => {
    beforeEach(() => {
      configureEditor();
    });

    it('disables the slider and shows the admin-only note', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(0.6),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      const slider = screen.getByLabelText(
        /Relevance Threshold/i,
      ) as HTMLInputElement;
      expect(slider).toBeDisabled();
      expect(
        screen.getByText(/Only admins can change the relevance threshold/i),
      ).toBeInTheDocument();
    });

    it('does not render Save or Reset buttons for editors', () => {
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: buildWorkspace(),
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      expect(
        screen.queryByRole('button', { name: /save threshold/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /reset/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('error states', () => {
    it('shows fallback when workspace is missing', () => {
      configureAdmin();
      mockUseIntelligenceWorkspace.mockReturnValue({
        data: null,
        isLoading: false,
      });

      render(<WorkspaceSettings workspaceId={VALID_UUID} />);
      expect(screen.getByText(/Workspace not found/i)).toBeInTheDocument();
    });
  });
});
