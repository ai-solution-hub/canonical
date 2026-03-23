import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/theme-provider';
import { CommandPalette } from '@/components/command-palette';
import { KeyboardShortcutsProvider } from '@/components/keyboard-shortcuts-provider';
import { ReadMarksProvider } from '@/contexts/read-marks-context';
import { TaxonomyProvider } from '@/contexts/taxonomy-context';
import { LayerVocabularyProvider } from '@/contexts/layer-vocabulary-context';
import { ClientFeaturesProvider } from '@/contexts/client-features-context';
import { CopilotPageContextProvider } from '@/contexts/copilot-page-context';
import { CopilotKitProvider } from '@/components/copilotkit-provider';
import { GlobalCopilotSidebar } from '@/components/global-copilot-sidebar';
import { GlobalCopilotReadable } from '@/components/global-copilot-readable';
import { SharedCopilotActions } from '@/components/shared-copilot-actions';
import { AuthAwareChrome } from '@/components/auth-aware-chrome';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import './styles/a11y.css';

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
              <CopilotKitProvider>
                <CopilotPageContextProvider>
                  <GlobalCopilotReadable />
                  <SharedCopilotActions />
                  <a href="#main-content" className="skip-link">
                    Skip to main content
                  </a>
                  <GlobalCopilotSidebar>
                    <AuthAwareChrome>
                      <main id="main-content">{children}</main>
                    </AuthAwareChrome>
                  </GlobalCopilotSidebar>
                  <CommandPalette />
                  <KeyboardShortcutsProvider />
                  <Toaster
                    position="bottom-right"
                    toastOptions={{
                      className: 'font-sans',
                    }}
                  />
                </CopilotPageContextProvider>
              </CopilotKitProvider>
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
