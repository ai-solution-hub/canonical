import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/theme-provider';
import { SiteHeader } from '@/components/site-header';
import { CommandPalette } from '@/components/command-palette';
import { KeyboardShortcutsProvider } from '@/components/keyboard-shortcuts-provider';
import { ReadMarksProvider } from '@/contexts/read-marks-context';
import { TaxonomyProvider } from '@/contexts/taxonomy-context';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import './styles/a11y.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Knowledge Hub',
  description: 'Knowledge base platform for AI-powered bid management',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${plusJakartaSans.variable} font-sans antialiased`}>
        <ThemeProvider>
          <TaxonomyProvider>
          <ReadMarksProvider>
            <TooltipProvider>
              <a href="#main-content" className="skip-link">
                Skip to main content
              </a>
              <SiteHeader />
              <main id="main-content">{children}</main>
              <CommandPalette />
              <KeyboardShortcutsProvider />
              <Toaster
                position="bottom-right"
                toastOptions={{
                  className: 'font-sans',
                }}
              />
            </TooltipProvider>
          </ReadMarksProvider>
          </TaxonomyProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
