import { useSyncExternalStore } from 'react';

/**
 * SSR-safe hydration check.
 * Returns `false` on the server and during initial hydration,
 * then `true` once the client has mounted.
 *
 * Pattern: `useSyncExternalStore`-with-`mounted`. The subscribe callback
 * fires `onStoreChange()` synchronously on first run so React re-snaps
 * after hydration, flipping the return from `false` to `true`.
 */
function subscribeToClientMount(onStoreChange: () => void) {
  onStoreChange();
  return () => {};
}

function getClientMountedSnapshot() {
  return true;
}

function getServerMountedSnapshot() {
  return false;
}

export function useHydrated() {
  return useSyncExternalStore(
    subscribeToClientMount,
    getClientMountedSnapshot,
    getServerMountedSnapshot,
  );
}
