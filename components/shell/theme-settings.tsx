'use client';

import { useState, useEffect } from 'react';
import { Settings2, Sun, Moon, Monitor, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useThemeMode } from '@/hooks/ui/use-theme-mode';
import {
  useAccessibility,
  type A11yMode,
  type A11yFont,
} from '@/hooks/ui/use-accessibility';

const COLOUR_MODE_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

const A11Y_MODES: { value: A11yMode; label: string; description: string }[] = [
  {
    value: 'dyslexia',
    label: 'Dyslexia-friendly',
    description: 'Enhanced spacing, weight, and optional font',
  },
  {
    value: 'high-contrast',
    label: 'High contrast',
    description: 'Maximum contrast ratios, doubled borders',
  },
  {
    value: 'large-text',
    label: 'Large text',
    description: '125% text scaling',
  },
];

const FONT_OPTIONS: { value: A11yFont; label: string }[] = [
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
];

export function ThemeSettings() {
  const { theme, setTheme } = useThemeMode();
  const {
    a11yMode,
    setA11yMode,
    a11yFont,
    setA11yFont,
    hasNonDefaultSettings,
  } = useAccessibility();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Standard hydration guard pattern to avoid SSR/client mismatch
    setMounted(true);
  }, []);

  // Show non-default indicator when theme is not system OR any a11y mode is active
  const showIndicator =
    mounted && (hasNonDefaultSettings || (theme !== 'system' && theme != null));

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Appearance settings"
        disabled
      >
        <Settings2 className="size-4" />
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Appearance settings"
          className="relative"
        >
          <Settings2 className="size-4" />
          {showIndicator && (
            <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Appearance Settings</DialogTitle>
          <DialogDescription>Customise your experience</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* Section 1: Colour Mode */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Colour Mode
            </h3>
            <RadioGroup
              value={theme ?? 'system'}
              onValueChange={(value) => setTheme(value)}
              className="flex gap-2"
            >
              {COLOUR_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <Label
                  key={value}
                  htmlFor={`theme-${value}`}
                  className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-accent"
                >
                  <RadioGroupItem
                    value={value}
                    id={`theme-${value}`}
                    className="sr-only"
                  />
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{label}</span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <Separator />

          {/* Section 2: Accessibility */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Accessibility
            </h3>
            <div className="flex flex-col gap-3">
              {A11Y_MODES.map(({ value, label, description }) => (
                <div key={value} className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <Label
                      htmlFor={`a11y-${value}`}
                      className="text-sm font-medium"
                    >
                      {label}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {description}
                    </span>
                  </div>
                  <Switch
                    id={`a11y-${value}`}
                    checked={a11yMode === value}
                    onCheckedChange={(checked) => {
                      setA11yMode(checked ? value : null);
                    }}
                  />
                </div>
              ))}

              {/* Font picker (visible when dyslexia mode is active) */}
              {a11yMode === 'dyslexia' && (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-dashed border-border p-3">
                  <Label
                    htmlFor="a11y-font"
                    className="text-sm text-muted-foreground"
                  >
                    Font
                  </Label>
                  <Select
                    value={a11yFont ?? 'atkinson'}
                    onValueChange={(value) => setA11yFont(value as A11yFont)}
                  >
                    <SelectTrigger id="a11y-font" className="h-8 w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Section 3: Themes */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Themes
            </h3>
            <button className="flex w-full items-center gap-3 rounded-lg border-2 border-primary bg-accent p-3 text-left">
              <div className="flex gap-1">
                <span
                  className="size-4 rounded-full"
                  style={{ backgroundColor: 'var(--background)' }}
                />
                <span
                  className="size-4 rounded-full"
                  style={{ backgroundColor: 'var(--primary)' }}
                />
                <span
                  className="size-4 rounded-full"
                  style={{ backgroundColor: 'var(--accent)' }}
                />
              </div>
              <span className="flex-1 text-sm font-medium">Default</span>
              <Check className="size-4 text-primary" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
