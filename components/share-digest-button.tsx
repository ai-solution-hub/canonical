'use client';

import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ShareDigestButtonProps {
  digestId: string;
  existingShareToken?: string | null;
  existingShareExpiresAt?: string | null;
}

/** Placeholder — digest sharing not yet implemented in Knowledge Hub. */
export function ShareDigestButton(_props: ShareDigestButtonProps) {
  return (
    <Button variant="outline" size="sm" disabled className="gap-1.5">
      <Share2 className="size-3.5" />
      Share
    </Button>
  );
}
