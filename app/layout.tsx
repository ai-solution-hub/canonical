import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/shell/theme-provider';
import { CommandPalette } from '@/components/shell/command-palette';
import { KeyboardShortcutsProvider } from '@/components/shell/keyboard-shortcuts-provider';
import { ReadMarksProvider } from '@/contexts/read-marks-context';
import { TaxonomyProvider } from '@/contexts/taxonomy-context';
import { LayerVocabularyProvider } from '@/contexts/layer-vocabulary-context';
import { ClientFeaturesProvider } from '@/contexts/client-features-context';
import { QueryProvider } from '@/lib/query/query-provider';
import { AuthAwareChrome } from '@/components/shell/auth-aware-chrome';
import { SessionGuard } from '@/components/shell/session-guard';
import { Analytics } from '@vercel/analytics/next';
import { BRANDING, buildBrandStyleProps } from '@/lib/client-config';
import './globals.css';
import './a11y.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: BRANDING.productName,
  description: BRANDING.tagline,
  icons: {
    icon: [
      ...(BRANDING.faviconSvgUrl
        ? [
            {
              url: `${BRANDING.faviconSvgUrl}?v=${process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'}`,
              type: 'image/svg+xml',
            },
          ]
        : []),
      {
        url: `${BRANDING.faviconPngUrl}?v=${process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'}`,
        type: 'image/png',
        sizes: '32x32',
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brandStyleProps = buildBrandStyleProps();
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {/* Brand CSS is build-time-computed from a Zod-validated JSON file —
            the content is never user-supplied, so raw HTML injection is safe.
            See lib/client-config.ts buildBrandStyleProps for the helper. */}
        <style {...brandStyleProps} />
      </head>
      <body className={`${instrumentSans.variable} font-sans antialiased`}>
        <ThemeProvider>
          <QueryProvider>
            <ClientFeaturesProvider>
              <TaxonomyProvider>
                <LayerVocabularyProvider>
                  <ReadMarksProvider>
                    <TooltipProvider>
                      <a href="#main-content" className="skip-link">
                        Skip to main content
                      </a>
                      <AuthAwareChrome>
                        <main id="main-content">{children}</main>
                      </AuthAwareChrome>
                      <CommandPalette />
                      <KeyboardShortcutsProvider />
                      <SessionGuard />
                      <Toaster
                        position="bottom-right"
                        toastOptions={{
                          className: 'font-sans',
                        }}
                      />
                    </TooltipProvider>
                  </ReadMarksProvider>
                </LayerVocabularyProvider>
              </TaxonomyProvider>
            </ClientFeaturesProvider>
          </QueryProvider>
        </ThemeProvider>
        {/* Vercel Web Analytics injects a <script src="/_vercel/insights/
            script.js"> unconditionally whenever NODE_ENV === 'production'
            (which `next start` always sets), regardless of whether the app
            is actually served by Vercel's edge network. On real Vercel
            deploys, Vercel's platform intercepts /_vercel/* before it
            reaches this app. Under a non-Vercel `next start` (local dev,
            CI e2e-nightly/e2e-smoke, self-hosted), that request falls
            through to proxy.ts, which redirects the unauthenticated,
            non-public path to /login (200 text/html) — and the browser
            then throws trying to execute that HTML as JS ("Unexpected
            token '<'", ID-128.13). Gate on Vercel's own runtime/build-time
            signal so the beacon is only ever requested where it resolves. */}
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  );
}
