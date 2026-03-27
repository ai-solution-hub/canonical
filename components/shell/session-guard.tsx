'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Monitors the "Stay signed in" preference from localStorage.
 * When the user opted out (unchecked during login), signs them out
 * when the browser tab or window is closed.
 *
 * This component renders nothing — it only manages the beforeunload listener.
 */
export function SessionGuard() {
  useEffect(() => {
    function handleBeforeUnload() {
      const staySignedIn = localStorage.getItem('kh-stay-signed-in');
      if (staySignedIn === 'false') {
        const supabase = createClient();
        // Use sendBeacon-style signOut — fire and forget on tab close.
        // Supabase JS clears local tokens synchronously; the server-side
        // revocation is best-effort during unload.
        supabase.auth.signOut();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return null;
}
