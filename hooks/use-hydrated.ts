import { useSyncExternalStore } from 'react';

/**
 * SSR-safe hydration check.
 * Returns `false` on the server and during initial hydration,
 * then `true` once the client has mounted.
 */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
