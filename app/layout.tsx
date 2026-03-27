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
import { AuthAwareChrome } from '@/components/shell/auth-aware-chrome';
import { SessionGuard } from '@/components/shell/session-guard';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import './a11y.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Knowledge Hub',
  description: 'Knowledge base platform for bid management',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', type: 'image/png', sizes: '32x32' },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body className={`${instrumentSans.variable} font-sans antialiased`}>
        <ThemeProvider>
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
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
