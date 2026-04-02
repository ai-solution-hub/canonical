import { Loader2 } from 'lucide-react';

export default function ConsentLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-accent/40">
      <div className="flex flex-col items-center gap-3" role="status">
        <Loader2
          className="size-8 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          Loading authorisation...
        </p>
      </div>
    </div>
  );
}
