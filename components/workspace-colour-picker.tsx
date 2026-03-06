'use client';

import { useState, useCallback, useRef } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const WORKSPACE_COLOURS = [
  { name: 'Amber', hex: '#d4880f' },
  { name: 'Copper', hex: '#c27840' },
  { name: 'Terracotta', hex: '#c4604a' },
  { name: 'Teal', hex: '#2b9e82' },
  { name: 'Sage', hex: '#5a8a6c' },
  { name: 'Ocean', hex: '#3b82b6' },
  { name: 'Indigo', hex: '#5b6abf' },
  { name: 'Plum', hex: '#8b5cc0' },
  { name: 'Rose', hex: '#c25670' },
  { name: 'Slate', hex: '#7a756c' },
  { name: 'Charcoal', hex: '#5c5750' },
  { name: 'Stone', hex: '#a8a49c' },
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface WorkspaceColourPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export function WorkspaceColourPicker({
  value,
  onChange,
}: WorkspaceColourPickerProps) {
  const [customHex, setCustomHex] = useState(() => {
    const isPreset = WORKSPACE_COLOURS.some((c) => c.hex === value);
    return isPreset ? '' : value;
  });

  const isPreset = WORKSPACE_COLOURS.some((c) => c.hex === value);

  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();

      const currentIdx = WORKSPACE_COLOURS.findIndex((c) => c.hex === value);
      let nextIdx: number;
      if (e.key === 'ArrowRight') {
        nextIdx = currentIdx < WORKSPACE_COLOURS.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : WORKSPACE_COLOURS.length - 1;
      }

      onChange(WORKSPACE_COLOURS[nextIdx].hex);
      setCustomHex('');

      // Focus the newly selected button
      requestAnimationFrame(() => {
        const el = groupRef.current?.querySelector<HTMLElement>(
          `[data-colour-idx="${nextIdx}"]`,
        );
        el?.focus();
      });
    },
    [value, onChange],
  );

  return (
    <div className="space-y-2">
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Colour"
        className="flex flex-wrap gap-2"
        onKeyDown={handleKeyDown}
      >
        {WORKSPACE_COLOURS.map((colour, idx) => {
          const selected = value === colour.hex;
          return (
            <button
              key={colour.hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={colour.name}
              tabIndex={selected ? 0 : -1}
              data-colour-idx={idx}
              title={colour.name}
              onClick={() => {
                onChange(colour.hex);
                setCustomHex('');
              }}
              className={cn(
                'relative size-7 rounded-full transition-all hover:scale-110',
                selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
              )}
              style={{ backgroundColor: colour.hex }}
            >
              {selected && (
                <Check className="absolute inset-0 m-auto size-3.5 text-white drop-shadow-sm" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <div
          className={cn(
            'size-7 shrink-0 rounded-full border',
            !isPreset && customHex && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
          style={{
            backgroundColor:
              !isPreset && HEX_RE.test(value) ? value : '#e5e7eb',
          }}
        />
        <Input
          type="text"
          placeholder="#hex"
          value={customHex}
          onChange={(e) => {
            const v = e.target.value;
            setCustomHex(v);
            if (HEX_RE.test(v)) {
              onChange(v);
            }
          }}
          className="h-7 w-24 font-mono text-xs"
          maxLength={7}
        />
      </div>
    </div>
  );
}
