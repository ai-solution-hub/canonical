'use client';

import { useState, useEffect } from 'react';
import { isMacPlatform } from '@/lib/utils';

/**
 * React hook for platform modifier key — safe for SSR (avoids hydration mismatch).
 * Returns empty string during SSR, resolves on client mount.
 */
export function useModifierKey(): string {
  const [mod, setMod] = useState('');
  useEffect(() => {
    setMod(isMacPlatform() ? '\u2318' : 'Ctrl+'); // eslint-disable-line react-hooks/set-state-in-effect -- intentional SSR-safe pattern
  }, []);
  return mod;
}
