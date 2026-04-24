/**
 * ProfileSection Component Tests
 *
 * Tests the profile settings section — loading state, form rendering,
 * dirty indicator, save/error flows, password validation, and beforeunload warning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockGetUser, mockUpdateUser, mockToast, mockUseUserRole } = vi.hoisted(
  () => ({
    mockGetUser: vi.fn(),
    mockUpdateUser: vi.fn(),
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    mockUseUserRole: {
      role: 'editor' as string | null,
      loading: false,
      canEdit: true,
      canAdmin: false,
    },
  }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole,
}));

// Mock NotificationPreferences to avoid QueryClientProvider dependency
vi.mock('@/components/settings/notification-preferences', () => ({
  NotificationPreferences: () => (
    <div data-testid="notification-preferences">Notifications</div>
  ),
}));

import { ProfileSection } from '@/components/settings/profile-section';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    user_metadata: { display_name: 'Test User' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProfileSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserRole.role = 'editor';
    mockUseUserRole.loading = false;
    mockGetUser.mockResolvedValue({ data: { user: createMockUser() } });
    mockUpdateUser.mockResolvedValue({ error: null });
    installRadixPointerShims();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading spinner while fetching profile', () => {
    // Make getUser hang
    mockGetUser.mockReturnValue(new Promise(() => {}));
    render(<ProfileSection />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('renders profile form with email (disabled), display name, and role badge', async () => {
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    expect(emailInput).toBeDisabled();
    expect(emailInput.value).toBe('test@example.com');

    const nameInput = screen.getByLabelText('Display Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Test User');

    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('shows dirty indicator dot when display name is changed', async () => {
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    });

    // Initially no unsaved changes indicator
    expect(screen.queryByLabelText('Unsaved changes')).not.toBeInTheDocument();

    // Use fireEvent to directly change the input value (more reliable with controlled inputs)
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'New Name' },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('saves profile and shows success toast', async () => {
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    });

    // Use fireEvent.change for reliable controlled input modification
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'Updated Name' },
    });

    // Click save button
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled();
    });

    expect(mockUpdateUser).toHaveBeenCalledWith({
      data: { display_name: 'Updated Name' },
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      'Profile updated successfully',
    );
  });

  it('shows error toast when save fails', async () => {
    mockUpdateUser.mockResolvedValue({ error: new Error('Update failed') });
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    });

    // Use fireEvent.change for reliable controlled input modification (matches test 4 pattern)
    fireEvent.change(screen.getByLabelText('Display Name'), {
      target: { value: 'Fail Name' },
    });

    // Click save button (isDirty should now be true, enabling the button)
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Update failed');
    });
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const user = userEvent.setup();
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('New Password'), 'short');
    await user.type(screen.getByLabelText('Confirm Password'), 'short');

    // Submit the password form (second form on the page)
    const changePasswordBtn = screen.getByRole('button', {
      name: 'Change Password',
    });
    await user.click(changePasswordBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Password must be at least 8 characters',
      );
    });

    expect(mockUpdateUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ password: expect.any(String) }),
    );
  });

  it('changes password successfully and clears fields', async () => {
    const user = userEvent.setup();
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('New Password'), 'newsecurepassword');
    await user.type(
      screen.getByLabelText('Confirm Password'),
      'newsecurepassword',
    );

    await user.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        password: 'newsecurepassword',
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      'Password changed successfully',
    );

    // Fields should be cleared
    await waitFor(() => {
      expect(
        (screen.getByLabelText('New Password') as HTMLInputElement).value,
      ).toBe('');
      expect(
        (screen.getByLabelText('Confirm Password') as HTMLInputElement).value,
      ).toBe('');
    });
  });

  it('registers beforeunload handler when form is dirty', async () => {
    const addEventSpy = vi.spyOn(window, 'addEventListener');
    const user = userEvent.setup();
    render(<ProfileSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText('Display Name'));
    await user.type(screen.getByLabelText('Display Name'), 'Dirty Name');

    // The beforeunload handler should be registered
    const beforeUnloadCalls = addEventSpy.mock.calls.filter(
      ([event]) => event === 'beforeunload',
    );
    expect(beforeUnloadCalls.length).toBeGreaterThan(0);

    addEventSpy.mockRestore();
  });

  // ── Primary focus (P0-4 spec §7.4) ──

  // Test 19: Primary focus displayed
  it('displays current primary_focus value as the selected dropdown label', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: createMockUser({
          user_metadata: {
            display_name: 'Test User',
            primary_focus: 'bid_writing',
          },
        }),
      },
    });

    render(<ProfileSection />);

    const trigger = await screen.findByLabelText('Primary Focus');
    // Radix Select renders the selected option's label inside the trigger.
    await waitFor(() => {
      expect(trigger).toHaveTextContent('Bid writing');
    });
  });

  // Test 20: Primary focus editable
  it('persists a Primary Focus selection via updateUser when the dropdown changes', async () => {
    const user = userEvent.setup();
    render(<ProfileSection />);

    const trigger = await screen.findByLabelText('Primary Focus');
    await user.click(trigger);

    const option = await screen.findByRole('option', {
      name: 'Account management',
    });
    await user.click(option);

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: { primary_focus: 'account_management' },
      });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Primary focus updated');
  });

  it('clears Primary Focus when the "None" sentinel is selected', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: createMockUser({
          user_metadata: {
            display_name: 'Test User',
            primary_focus: 'marketing',
          },
        }),
      },
    });
    const user = userEvent.setup();
    render(<ProfileSection />);

    const trigger = await screen.findByLabelText('Primary Focus');
    await waitFor(() => {
      expect(trigger).toHaveTextContent('Marketing content');
    });

    await user.click(trigger);
    const noneOption = await screen.findByRole('option', {
      name: /no preference/i,
    });
    await user.click(noneOption);

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: { primary_focus: null },
      });
    });
  });
});
