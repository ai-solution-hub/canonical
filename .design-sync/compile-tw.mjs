// Compile the app's Tailwind v4 source (app/globals.css) into a browser-ready
// stylesheet for design-sync's cssEntry: utilities + :root/.dark token vars,
// scanning the component + authored-preview sources for used classes.
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const INPUT = 'app/globals.css';
const OUT = '.design-sync/.cache/compiled.css';
mkdirSync('.design-sync/.cache', { recursive: true });

// Brand font: the app self-hosts Instrument Sans via next/font/google (no
// @font-face in globals.css). Ship it to the design runtime via a Google Fonts
// @import (OFL-licensed; loaded at runtime → [FONT_REMOTE], the real brand font
// not a substitute). @import must precede all other rules, so prepend it.
const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap');\n";

const css = readFileSync(INPUT, 'utf8');
const result = await postcss([tailwindcss({ base: process.cwd() })]).process(
  css,
  {
    from: INPUT,
    to: OUT,
  },
);
writeFileSync(OUT, FONT_IMPORT + result.css);

const txt = result.css;
console.log('compiled bytes:', txt.length);
console.log('has .bg-background:', txt.includes('.bg-background'));
console.log('has --background token:', txt.includes('--background'));
console.log('has .flex:', /\.flex\b/.test(txt));
console.log('has .dark:', txt.includes('.dark'));
