'use client';

import { useEffect } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Login error:', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-accent/40 px-4"
    >
      <div>
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide text-foreground">
            Knowledge Hub
          </h1>
        </div>
        <Card className="w-full max-w-md border-t-2 border-t-destructive">
          <CardContent className="flex flex-col items-center gap-4 px-8 py-8 text-center">
            <KeyRound
              className="size-10 text-muted-foreground/50"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold text-foreground">
              Couldn&apos;t load the sign-in page
            </h2>
            <p className="text-sm text-muted-foreground">
              This is usually temporary. Please try again.
            </p>
            <Button onClick={reset} variant="outline">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
