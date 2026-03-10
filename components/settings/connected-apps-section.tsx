'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldX, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OAuthGrant {
  client: {
    id: string;
    name: string;
    uri: string;
    logo_uri: string;
  };
  scopes: string[];
  granted_at: string;
}

// ---------------------------------------------------------------------------
// Scope label formatting
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Identity verification',
  profile: 'Profile information',
  email: 'Email address',
  read: 'Read access',
  write: 'Write access',
};

function formatScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Connected Apps Section
// ---------------------------------------------------------------------------

export function ConnectedAppsSection() {
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchGrants = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/oauth/grants');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setGrants(data.grants ?? []);
    } catch {
      // Silently handle — grants may not be available if OAuth server is not enabled
      setGrants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGrants();
  }, [fetchGrants]);

  async function handleRevoke(clientId: string, clientName: string) {
    setRevoking(clientId);
    try {
      const res = await fetch('/api/oauth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to revoke');
      }

      toast.success(`Revoked access for ${clientName}`);
      setGrants((prev) => prev.filter((g) => g.client.id !== clientId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke access';
      toast.error(message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Connected Apps</CardTitle>
          {!loading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchGrants}
              aria-label="Refresh connected apps"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="Loading connected apps"
            />
          </div>
        ) : grants.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No connected apps. When you authorise an application to access your
            Knowledge Hub, it will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" role="list">
            {grants.map((grant) => (
              <li
                key={grant.client.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
              >
                <div className="flex items-start gap-3">
                  <ShieldCheck
                    className="mt-0.5 size-5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {grant.client.name}
                    </p>
                    {grant.client.uri && (
                      <p className="text-xs text-muted-foreground">
                        {grant.client.uri}
                      </p>
                    )}
                    {grant.scopes.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {grant.scopes.map(formatScope).join(', ')}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Connected {formatDate(grant.granted_at)}
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRevoke(grant.client.id, grant.client.name)}
                  disabled={revoking === grant.client.id}
                  className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {revoking === grant.client.id ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldX className="mr-1.5 size-3.5" aria-hidden="true" />
                  )}
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
