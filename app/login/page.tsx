'use client';

import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = useState('');
  const [magicLinkSending, setMagicLinkSending] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const supabase = createClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsLoading(false);
      return;
    }

    // Full page navigation ensures the auth cookies are sent with the request.
    // Using router.push() would trigger a client-side navigation where the
    // proxy may not yet see the freshly-set session cookies.
    window.location.href = '/';
  }

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    setMagicLinkError(null);
    setMagicLinkSent(false);
    setMagicLinkSending(true);

    const supabase = createClient();

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: magicLinkEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (otpError) {
      setMagicLinkError(otpError.message);
      setMagicLinkSending(false);
      return;
    }

    setMagicLinkSent(true);
    setMagicLinkSending(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            Knowledge Hub
          </CardTitle>
          <CardDescription>
            Sign in to your knowledge base
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={async () => {
                    if (!email) {
                      setError('Enter your email first, then click Forgot password');
                      return;
                    }
                    setError(null);
                    const supabase = createClient();
                    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${window.location.origin}/auth/callback`,
                    });
                    if (resetError) {
                      setError(resetError.message);
                    } else {
                      setError(null);
                      alert('Password reset email sent. Check your inbox.');
                    }
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          {/* Magic link */}
          <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
            <Label htmlFor="magic-link-email" className="text-sm font-medium">
              Sign in with magic link
            </Label>
            <div className="flex gap-2">
              <Input
                id="magic-link-email"
                type="email"
                placeholder="you@example.com"
                value={magicLinkEmail}
                onChange={(e) => setMagicLinkEmail(e.target.value)}
                required
                autoComplete="email"
                className="flex-1"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={magicLinkSending}
                className="shrink-0"
              >
                {magicLinkSending ? 'Sending...' : 'Send magic link'}
              </Button>
            </div>

            {magicLinkSent && (
              <p className="text-sm text-[var(--success,hsl(142_71%_45%))]" role="status">
                Check your email for a sign-in link
              </p>
            )}

            {magicLinkError && (
              <p className="text-sm text-destructive" role="alert">
                {magicLinkError}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
