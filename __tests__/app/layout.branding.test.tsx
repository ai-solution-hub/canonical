import { describe, it, expect, vi } from 'vitest';
import {
  BRANDING,
  BRANDING_PRIMARY_FOREGROUND,
  BRANDING_PRIMARY_DARK,
  BRANDING_PRIMARY_FOREGROUND_DARK,
  buildBrandStyleProps,
} from '@/lib/client-config';

// Mock next/font/google to avoid the Instrument_Sans not-a-function error
vi.mock('next/font/google', () => ({
  Instrument_Sans: () => ({ variable: '--font-sans' }),
}));

// Now we can safely import metadata from the layout
const { metadata } = await import('@/app/layout');

describe('layout metadata branding', () => {
  it('uses BRANDING.productName as the title', () => {
    expect(metadata.title).toBe(BRANDING.productName);
  });

  it('uses BRANDING.tagline as the description', () => {
    expect(metadata.description).toBe(BRANDING.tagline);
  });

  it('includes favicon SVG URL from BRANDING', () => {
    const icons = metadata.icons as {
      icon: Array<{ url: string; type: string }>;
    };
    expect(icons.icon[0].url).toContain(BRANDING.faviconSvgUrl);
    expect(icons.icon[0].type).toBe('image/svg+xml');
  });

  it('includes favicon PNG URL from BRANDING', () => {
    const icons = metadata.icons as {
      icon: Array<{ url: string; type: string }>;
    };
    expect(icons.icon[1].url).toContain(BRANDING.faviconPngUrl);
    expect(icons.icon[1].type).toBe('image/png');
  });
});

describe('buildBrandStyleProps', () => {
  it('returns an object with CSS containing --primary', () => {
    const props = buildBrandStyleProps();
    const keys = Object.keys(props);
    expect(keys.length).toBe(1);
    const html = props[keys[0]].__html;
    expect(html).toContain('--primary:');
    expect(html).toContain(BRANDING.brandPrimaryColour);
  });

  it('contains the dark-mode variant', () => {
    const props = buildBrandStyleProps();
    const keys = Object.keys(props);
    const html = props[keys[0]].__html;
    expect(html).toContain('.dark');
    expect(html).toContain(BRANDING_PRIMARY_DARK);
  });

  it('contains --primary-foreground', () => {
    const props = buildBrandStyleProps();
    const keys = Object.keys(props);
    const html = props[keys[0]].__html;
    expect(html).toContain('--primary-foreground:');
    expect(html).toContain(BRANDING_PRIMARY_FOREGROUND);
  });

  it('contains --ring set to primary colour', () => {
    const props = buildBrandStyleProps();
    const keys = Object.keys(props);
    const html = props[keys[0]].__html;
    expect(html).toContain('--ring:');
  });

  it('contains dark-mode foreground', () => {
    const props = buildBrandStyleProps();
    const keys = Object.keys(props);
    const html = props[keys[0]].__html;
    expect(html).toContain(BRANDING_PRIMARY_FOREGROUND_DARK);
  });
});
