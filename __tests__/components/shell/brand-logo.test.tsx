import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo } from '@/components/shell/brand-logo';

// next/image is mocked by the test setup to render plain <img> tags.

describe('BrandLogo', () => {
  it('renders two images (light and dark mode)', () => {
    render(<BrandLogo />);
    const images = screen.getAllByRole('img');
    expect(images.length).toBe(2);
  });

  it('renders alt text from BRANDING.logoAlt', () => {
    render(<BrandLogo />);
    const images = screen.getAllByAltText('Canonical logo');
    expect(images.length).toBe(2);
  });

  it('renders aria-label on wrapping span', () => {
    render(<BrandLogo />);
    const wrapper = screen.getByLabelText('Canonical logo');
    expect(wrapper).toBeDefined();
  });

  it('renders sr-only product name in full variant', () => {
    render(<BrandLogo variant="full" />);
    const srOnly = screen.getByText('Canonical');
    expect(srOnly).toBeDefined();
    expect(srOnly.className).toContain('sr-only');
  });

  it('does not render sr-only product name in compact variant', () => {
    render(<BrandLogo variant="compact" />);
    expect(screen.queryByText('Canonical')).toBeNull();
  });

  it('applies dark:hidden and dark:block classes for variant switching', () => {
    render(<BrandLogo />);
    const images = screen.getAllByRole('img');
    // Light-mode image has block dark:hidden
    expect(images[0].className).toContain('dark:hidden');
    // Dark-mode image has hidden dark:block
    expect(images[1].className).toContain('dark:block');
  });

  it('applies custom className when provided', () => {
    render(<BrandLogo className="custom-class" />);
    const wrapper = screen.getByLabelText('Canonical logo');
    expect(wrapper.className).toContain('custom-class');
  });
});
