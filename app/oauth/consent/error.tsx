'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BRANDING } from '@/lib/client-config';

export default function ConsentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('OAuth consent error:', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-accent/40 px-4"
    >
      <div>
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide text-foreground">
            {BRANDING.productName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Authorise external access
          </p>
        </div>
        <Card className="w-full max-w-md border-t-2 border-t-destructive">
          <CardContent className="flex flex-col items-center gap-4 px-8 py-8 text-center">
            <ShieldX
              className="size-10 text-muted-foreground/50"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold text-foreground">
              Couldn&apos;t load the authorisation page
            </h2>
            <p className="text-sm text-muted-foreground">
              The OAuth flow may have expired. Please try again from your
              application.
            </p>
            <div className="flex gap-3">
              <Button onClick={reset} variant="outline">
                Try again
              </Button>
              <Button asChild variant="ghost">
                <Link href="/">Return home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
