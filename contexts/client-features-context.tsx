'use client';

import { createContext, useContext, useMemo } from 'react';
import {
  CLIENT_CONFIG,
  isFeatureEnabled,
  type FeatureName,
  type FeatureToggle,
  type LayerDefinition,
} from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientFeaturesContextValue {
  /** All feature toggles */
  features: Record<FeatureName, FeatureToggle>;
  /** Layer vocabulary definitions (ordered) */
  layerVocabulary: readonly LayerDefinition[];
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
      layerVocabulary: CLIENT_CONFIG.layer_vocabulary,
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

/**
 * Access client feature configuration from any client component.
 * Must be used within ClientFeaturesProvider.
 */
export function useClientFeatures(): ClientFeaturesContextValue {
  const ctx = useContext(ClientFeaturesContext);
  if (!ctx)
    throw new Error(
      'useClientFeatures must be used within ClientFeaturesProvider',
    );
  return ctx;
}
