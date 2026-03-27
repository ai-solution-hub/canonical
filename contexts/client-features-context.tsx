'use client';

import { createContext, useMemo } from 'react';
import {
  CLIENT_CONFIG,
  isFeatureEnabled,
  type FeatureName,
  type FeatureToggle,
} from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientFeaturesContextValue {
  /** All feature toggles */
  features: Record<FeatureName, FeatureToggle>;
  /** Check whether a named feature is enabled */
  isFeatureEnabled: (feature: FeatureName) => boolean;
  /** Client display name */
  clientName: string;
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const ClientFeaturesContext =
  createContext<ClientFeaturesContextValue | null>(null);

export function ClientFeaturesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useMemo<ClientFeaturesContextValue>(
    () => ({
      features: CLIENT_CONFIG.features,
      isFeatureEnabled,
      clientName: CLIENT_CONFIG.client_name,
    }),
    [],
  );

  return (
    <ClientFeaturesContext.Provider value={value}>
      {children}
    </ClientFeaturesContext.Provider>
  );
}

