/**
 * Auth configuration helpers for tests.
 *
 * Builds on mock-supabase.ts to provide a fluent API for configuring
 * authentication and authorisation state per test.
 */
import type { MockSupabaseClient } from './mock-supabase';
import { configureRole, configureUnauthenticated } from './mock-supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRole = 'admin' | 'editor' | 'viewer';

interface UserOverrides {
  id?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for configuring auth state on a mock Supabase client.
 *
 * Usage:
 *   configureAuth(mockSupabase).asAdmin()
 *   configureAuth(mockSupabase).asEditor()
 *   configureAuth(mockSupabase).asUnauthenticated()
 *   configureAuth(mockSupabase).withUser({ id: 'custom-id' }).asAdmin()
 */
export function configureAuth(client: MockSupabaseClient) {
  return {
    /** Configure as admin with default test user */
    asAdmin() {
      configureRole(client, 'admin');
      return this;
    },

    /** Configure as editor with default test user */
    asEditor() {
      configureRole(client, 'editor');
      return this;
    },

    /** Configure as viewer with default test user */
    asViewer() {
      configureRole(client, 'viewer');
      return this;
    },

    /** Configure as unauthenticated (no session) */
    asUnauthenticated() {
      configureUnauthenticated(client);
      return this;
    },

    /** Configure a custom user identity, then chain with a role */
    withUser(overrides: UserOverrides) {
      client.auth.getUser.mockResolvedValueOnce({
        data: {
          user: {
            id: overrides.id ?? 'test-user-id',
            email: overrides.email ?? 'test@example.com',
            user_metadata: overrides.user_metadata ?? {},
          },
        },
        error: null,
      });
      return this;
    },

    /** Configure a custom role (for roles not covered by convenience methods) */
    withRole(role: UserRole) {
      configureRole(client, role);
      return this;
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-built auth scenarios
// ---------------------------------------------------------------------------

/**
 * Configure an authenticated admin user.
 * Shorthand for configureAuth(client).asAdmin().
 */
export function configureAdmin(client: MockSupabaseClient) {
  configureRole(client, 'admin');
}

/**
 * Configure an authenticated editor user.
 * Shorthand for configureAuth(client).asEditor().
 */
export function configureEditor(client: MockSupabaseClient) {
  configureRole(client, 'editor');
}

/**
 * Configure an authenticated viewer user.
 * Shorthand for configureAuth(client).asViewer().
 */
export function configureViewer(client: MockSupabaseClient) {
  configureRole(client, 'viewer');
}

// Re-export base helpers for convenience
export { configureRole, configureUnauthenticated } from './mock-supabase';
