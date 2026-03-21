/**
 * OAuth consent page for MCP client authorisation.
 *
 * When an MCP client (e.g. Claude Desktop) initiates OAuth, Supabase redirects
 * the user here with an `authorization_id` query parameter. The page shows
 * what the client is requesting and lets the user approve or deny.
 *
 * Uses Warm Meridian design system — restrained palette, structured absence,
 * Card with primary border accent.
 */
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldX } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Authorise Application',
};

interface ConsentPageProps {
  searchParams: Promise<{ authorization_id?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const params = await searchParams;
  const authorizationId = params.authorization_id;

  if (!authorizationId) {
    return (
      <ConsentLayout>
        <ErrorCard message="Missing authorisation ID. This page should be accessed via an OAuth flow." />
      </ConsentLayout>
    );
  }

  const supabase = await createClient();

  // Check if user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Redirect to login, preserving the authorization_id
    redirect(
      `/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`,
    );
  }

  // Get authorization details
  const { data: authDetails, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !authDetails) {
    return (
      <ConsentLayout>
        <ErrorCard
          message={error?.message ?? 'Invalid authorisation request.'}
        />
      </ConsentLayout>
    );
  }

  // If user already consented, redirect immediately
  if ('redirect_url' in authDetails) {
    redirect(authDetails.redirect_url);
  }

  // Show consent screen
  const scopes = authDetails.scope?.trim()
    ? authDetails.scope.split(' ')
    : [];

  return (
    <ConsentLayout>
      <Card className="w-full max-w-md border-t-2 border-t-primary">
        <CardContent className="px-8 py-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <ShieldCheck className="size-10 text-primary" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-foreground">
              Authorise {authDetails.client.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              This application wants to access your Knowledge Hub account.
            </p>
          </div>

          <div className="mt-6 space-y-3 rounded-lg border border-border bg-accent/30 p-4">
            <DetailRow label="Application" value={authDetails.client.name} />
            {authDetails.client.uri && (
              <DetailRow label="Website" value={authDetails.client.uri} truncate />
            )}
            <DetailRow label="Account" value={user.email ?? user.id} />
            {scopes.length > 0 && (
              <div>
                <p id="requested-permissions-label" className="text-xs font-medium text-muted-foreground">
                  Requested permissions
                </p>
                <ul aria-labelledby="requested-permissions-label" className="mt-1 list-inside list-disc text-sm text-foreground">
                  {scopes.map((scope) => (
                    <li key={scope}>{formatScope(scope)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <form
            action="/api/oauth/decision"
            method="POST"
            className="mt-6 flex flex-col gap-3"
          >
            <input
              type="hidden"
              name="authorization_id"
              value={authorizationId}
            />

            <Button
              type="submit"
              name="decision"
              value="approve"
              className="w-full"
            >
              <ShieldCheck className="mr-2 size-4" aria-hidden="true" />
              Approve
            </Button>

            <Button
              type="submit"
              name="decision"
              value="deny"
              variant="outline"
              className="w-full"
            >
              <ShieldX className="mr-2 size-4" aria-hidden="true" />
              Deny
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            You can revoke this access at any time from{' '}
            <a
              href="/settings?section=integrations"
              className="underline underline-offset-2 hover:text-foreground"
            >
              your settings
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </ConsentLayout>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function ConsentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-accent/40 px-4">
      <div>
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide text-foreground">
            Knowledge Hub
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Authorise external access
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="w-full max-w-md border-t-2 border-t-destructive">
      <CardContent className="px-8 py-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <ShieldX className="size-10 text-destructive" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">
            Authorisation Error
          </h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Link
            href="/"
            className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Return home
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground${truncate ? ' max-w-xs truncate' : ''}`} title={truncate ? value : undefined}>{value}</p>
    </div>
  );
}

/** Format OAuth scope strings for display */
function formatScope(scope: string): string {
  const scopeLabels: Record<string, string> = {
    openid: 'Verify your identity',
    profile: 'View your profile information',
    email: 'View your email address',
    read: 'Read your knowledge base content',
    write: 'Create and edit content',
  };
  return scopeLabels[scope] ?? scope;
}
