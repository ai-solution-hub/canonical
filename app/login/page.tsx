'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { ArrowLeft, ChevronRight, KeyRound, Mail, Loader2 } from 'lucide-react';

type LoginStep = 'email' | 'method' | 'password' | 'magic-link-sent' | 'forgot-sent';

export default function LoginPage() {
  // Read redirect param for post-login navigation (e.g. OAuth consent flow)
  const redirectTo = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('redirect')
    : null;

  // --- State ---
  const [step, setStep] = useState<LoginStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [forgotStatus, setForgotStatus] = useState<'idle' | 'sending'>('idle');
  const [forgotResendStatus, setForgotResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [staySignedIn, setStaySignedIn] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('kh-stay-signed-in');
    return stored === null ? true : stored === 'true';
  });

  // --- Refs (for focus management) ---
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const methodFirstRef = useRef<HTMLButtonElement>(null);
  const methodSecondRef = useRef<HTMLButtonElement>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const forgotHeadingRef = useRef<HTMLHeadingElement>(null);

  // --- Step navigation ---
  function goToStep(newStep: LoginStep) {
    setError(null);
    setIsLoading(false);
    setStep(newStep);
  }

  function goBack() {
    if (step === 'method') {
      goToStep('email');
    } else if (step === 'password' || step === 'magic-link-sent') {
      goToStep('method');
    } else if (step === 'forgot-sent') {
      goToStep('password');
    }
  }

  // --- Focus management on step transitions ---
  useEffect(() => {
    requestAnimationFrame(() => {
      if (step === 'email') {
        emailInputRef.current?.focus();
      } else if (step === 'method') {
        methodFirstRef.current?.focus();
      } else if (step === 'password') {
        passwordInputRef.current?.focus();
      } else if (step === 'magic-link-sent') {
        confirmHeadingRef.current?.focus();
      } else if (step === 'forgot-sent') {
        forgotHeadingRef.current?.focus();
      }
    });
  }, [step]);

  // --- Keyboard handler (Escape for back navigation) ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && step !== 'email') {
        e.preventDefault();
        goBack();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // --- Email validation ---
  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  // --- Handlers ---
  function handleEmailContinue(e: FormEvent) {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    goToStep('method');
  }

  async function handlePasswordSignIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const supabase = createClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      if ('status' in signInError && signInError.status === 429) {
        setError('Too many attempts. Please wait a moment before trying again.');
      } else {
        setError(
          "That email and password combination didn't work. Please try again."
        );
      }
      setIsLoading(false);
      return;
    }

    // Full page navigation ensures the auth cookies are sent with the request.
    // Using router.push() would trigger a client-side navigation where the
    // proxy may not yet see the freshly-set session cookies.
    // Honour redirect param if present (e.g. OAuth consent flow).
    window.location.href = redirectTo ?? '/';
  }

  async function handleSendMagicLink() {
    setError(null);
    setIsLoading(true);

    const supabase = createClient();

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (otpError) {
      if ('status' in otpError && otpError.status === 429) {
        setError('Too many attempts. Please wait a moment before trying again.');
      } else {
        setError(
          "We couldn't send the sign-in link. Please check your email address and try again."
        );
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setStep('magic-link-sent');
    setResendStatus('idle');
  }

  async function handleResendMagicLink() {
    setResendStatus('sending');

    const supabase = createClient();

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (otpError) {
      setError(
        "We couldn't resend the sign-in link. Please try again."
      );
      setResendStatus('idle');
      return;
    }

    setResendStatus('sent');
    setTimeout(() => setResendStatus('idle'), 3000);
  }

  async function handleForgotPassword() {
    setForgotStatus('sending');
    setError(null);

    const supabase = createClient();

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/auth/callback` }
    );

    if (resetError) {
      setError(resetError.message);
      setForgotStatus('idle');
      return;
    }

    setForgotStatus('idle');
    setForgotResendStatus('idle');
    goToStep('forgot-sent');
  }

  async function handleResendForgotPassword() {
    setForgotResendStatus('sending');

    const supabase = createClient();

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/auth/callback` }
    );

    if (resetError) {
      setError(
        "We couldn't resend the reset link. Please try again."
      );
      setForgotResendStatus('idle');
      return;
    }

    setForgotResendStatus('sent');
    setTimeout(() => setForgotResendStatus('idle'), 3000);
  }

  // --- Back button ---
  function renderBackButton() {
    return (
      <button
        type="button"
        onClick={goBack}
        className="mb-4 flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Go back"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>
    );
  }

  // --- Email display (clickable to go back to Step 1) ---
  function renderEmailDisplay() {
    return (
      <button
        type="button"
        onClick={() => {
          goToStep('email');
          // Select email text so user can immediately retype
          requestAnimationFrame(() => {
            emailInputRef.current?.select();
          });
        }}
        className="mb-4 inline-flex items-center rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Signed in as ${email}. Click to change.`}
      >
        {email}
      </button>
    );
  }

  // --- Step renderers ---
  function renderEmailStep() {
    return (
      <form onSubmit={handleEmailContinue} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            ref={emailInputRef}
            id="email"
            type="email"
            placeholder="sarah@company.co.uk"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            required
            autoComplete="email"
            aria-describedby={error ? 'email-error' : undefined}
          />
        </div>

        {error && (
          <p id="email-error" className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    );
  }

  function renderMethodStep() {
    return (
      <div className="flex flex-col gap-4">
        {renderBackButton()}

        <div>
          <h2 className="text-lg font-semibold text-foreground">Welcome back</h2>
          {renderEmailDisplay()}
        </div>

        <p className="text-sm text-muted-foreground">
          How would you like to sign in?
        </p>

        <div className="flex flex-col gap-3">
          <button
            ref={methodFirstRef}
            type="button"
            onClick={() => goToStep('password')}
            aria-label="Sign in with password"
            className="w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <KeyRound className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Enter password
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Use your account password
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          </button>

          <button
            ref={methodSecondRef}
            type="button"
            onClick={handleSendMagicLink}
            disabled={isLoading}
            aria-label="Sign in with magic link"
            className="w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isLoading ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                ) : (
                  <Mail className="size-5 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {isLoading ? 'Sending...' : 'Send magic link'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Get a sign-in link by email
                  </p>
                </div>
              </div>
              {!isLoading && (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  function renderPasswordStep() {
    return (
      <form onSubmit={handlePasswordSignIn} className="flex flex-col gap-4">
        {renderBackButton()}

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Enter your password
          </h2>
          {renderEmailDisplay()}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            ref={passwordInputRef}
            id="password"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            required
            autoComplete="current-password"
            aria-describedby={error ? 'password-error' : undefined}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="stay-signed-in"
            checked={staySignedIn}
            onCheckedChange={(checked) => {
              const value = checked === true;
              setStaySignedIn(value);
              localStorage.setItem('kh-stay-signed-in', String(value));
            }}
          />
          <Label htmlFor="stay-signed-in" className="text-sm text-muted-foreground cursor-pointer">
            Stay signed in
          </Label>
        </div>

        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={forgotStatus === 'sending'}
          className="self-start rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {forgotStatus === 'sending' ? 'Sending reset...' : 'Forgot password?'}
        </button>

        {error && (
          <p id="password-error" className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    );
  }

  function renderMagicLinkSentStep() {
    return (
      <div className="flex flex-col gap-4">
        {renderBackButton()}

        <div className="flex flex-col items-center gap-3 text-center">
          <Mail className="size-10 text-primary" />
          <h2
            ref={confirmHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-foreground outline-none"
          >
            Check your email
          </h2>
          <p className="text-sm text-foreground">
            We sent a sign-in link to{' '}
            <span className="font-medium">{email}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            The link expires in 60 minutes.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-sm text-muted-foreground">
            {"Didn't receive it?"}
          </p>
          <div className="flex items-center gap-3" aria-live="polite">
            <button
              type="button"
              onClick={handleResendMagicLink}
              disabled={resendStatus === 'sending'}
              className="rounded-sm text-sm text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {resendStatus === 'sending'
                ? 'Resending...'
                : resendStatus === 'sent'
                  ? 'Sent!'
                  : 'Resend'}
            </button>
            <span className="text-sm text-muted-foreground" aria-hidden="true">|</span>
            <button
              type="button"
              onClick={() => goToStep('password')}
              className="rounded-sm text-sm text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Try password instead
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  function renderForgotSentStep() {
    return (
      <div className="flex flex-col gap-4">
        {renderBackButton()}

        <div className="flex flex-col items-center gap-3 text-center">
          <KeyRound className="size-10 text-primary" />
          <h2
            ref={forgotHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-foreground outline-none"
          >
            Check your email
          </h2>
          <p className="text-sm text-foreground">
            We sent a password reset link to{' '}
            <span className="font-medium">{email}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            The link expires in 60 minutes.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-sm text-muted-foreground">
            {"Didn't receive it?"}
          </p>
          <div className="flex items-center gap-3" aria-live="polite">
            <button
              type="button"
              onClick={handleResendForgotPassword}
              disabled={forgotResendStatus === 'sending'}
              className="rounded-sm text-sm text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {forgotResendStatus === 'sending'
                ? 'Resending...'
                : forgotResendStatus === 'sent'
                  ? 'Sent!'
                  : 'Resend'}
            </button>
            <span className="text-sm text-muted-foreground" aria-hidden="true">|</span>
            <button
              type="button"
              onClick={() => goToStep('password')}
              className="rounded-sm text-sm text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Try signing in instead
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-accent/40 px-4" aria-label="Sign in to Knowledge Hub">
      <div>
        {/* Brand mark — visible on all steps */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide text-foreground">
            Knowledge Hub
          </h1>
          {step === 'email' && (
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to your knowledge base
            </p>
          )}
        </div>

        <Card className="w-full max-w-md border-t-2 border-t-primary">
          <CardContent className="px-8 py-8">
            {/* ARIA live region for step announcements */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {step === 'email' && 'Step 1 of 3: Enter your email address'}
              {step === 'method' && 'Step 2 of 3: Choose your sign-in method'}
              {step === 'password' && 'Step 3 of 3: Enter your password'}
              {step === 'magic-link-sent' &&
                'Step 3 of 3: Sign-in link sent. Check your email.'}
              {step === 'forgot-sent' &&
                'Password reset link sent. Check your email.'}
            </div>

            {/* Step content with enter animation */}
            <div
              key={step}
              className="animate-[step-enter_200ms_ease-out] motion-reduce:animate-none"
            >
              {step === 'email' && renderEmailStep()}
              {step === 'method' && renderMethodStep()}
              {step === 'password' && renderPasswordStep()}
              {step === 'magic-link-sent' && renderMagicLinkSentStep()}
              {step === 'forgot-sent' && renderForgotSentStep()}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
