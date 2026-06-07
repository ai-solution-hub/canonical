/**
 * ID-68.20 — branding codegen (deploy-overlay seam).
 *
 * Covers the build-prestep codegen that replaces the static branding map
 * in lib/client-config.ts (TECH PC-33-A mechanism half / DEPLOY-OVERLAY
 * Option 2). The generated module is a pure function of the
 * lib/branding/clients/*.json directory contents: a public tree with
 * only default.json renders a default-only map (DEPLOY-OVERLAY §6
 * no-overlay regression guard); a deploy overlay that ADDS client JSON
 * files expands the map with no source edit.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  listClientIds,
  renderClientBrandingMap,
} from '@/scripts/generate-client-branding-map';

const CLIENTS_DIR = join(process.cwd(), 'lib', 'branding', 'clients');
const GENERATED_PATH = join(
  process.cwd(),
  'lib',
  'branding',
  'client-branding-map.generated.ts',
);

describe('listClientIds', () => {
  it('strips .json extensions and ignores non-JSON files', () => {
    expect(
      listClientIds(['default.json', 'acme.json', 'README.md', '.DS_Store']),
    ).toEqual(['acme', 'default']);
  });

  it('sorts ids deterministically regardless of input order', () => {
    expect(listClientIds(['zeta.json', 'default.json', 'acme.json'])).toEqual([
      'acme',
      'default',
      'zeta',
    ]);
  });
});

describe('renderClientBrandingMap', () => {
  it('renders a default-only map for a tree with no overlay clients', () => {
    // DEPLOY-OVERLAY §6 regression guard (code-slice form): with only
    // default.json present, the generated map contains exactly one entry
    // and the loader resolves `default` for any unknown id.
    const source = renderClientBrandingMap(['default']);
    expect(source).toContain(
      "import branding0 from '@/lib/branding/clients/default.json';",
    );
    expect(source).toContain('"default": branding0,');
    // Exactly one map entry — no other client compiled into the bundle.
    expect(source.match(/branding\d+,/g)).toHaveLength(1);
  });

  it('ADDS overlay client entries alongside default', () => {
    const source = renderClientBrandingMap(['acme', 'default']);
    expect(source).toContain(
      "import branding0 from '@/lib/branding/clients/acme.json';",
    );
    expect(source).toContain(
      "import branding1 from '@/lib/branding/clients/default.json';",
    );
    expect(source).toContain('"acme": branding0,');
    expect(source).toContain('"default": branding1,');
  });

  it('is deterministic: unsorted input renders sorted output', () => {
    expect(renderClientBrandingMap(['zeta', 'default', 'acme'])).toEqual(
      renderClientBrandingMap(['acme', 'zeta', 'default']),
    );
  });

  it('throws when default is absent (fallback target must always exist)', () => {
    expect(() => renderClientBrandingMap(['acme'])).toThrowError(/default/);
  });

  it('rejects non-slug client ids (codegen emits import paths)', () => {
    expect(() => renderClientBrandingMap(['default', 'bad id!'])).toThrowError(
      /slug/i,
    );
  });
});

describe('generated module sync (guards dir ↔ committed file drift)', () => {
  it('committed client-branding-map.generated.ts matches a fresh render of lib/branding/clients/', () => {
    // If a client JSON is added or removed without re-running
    // `bun run generate:branding`, this fails — mirroring the
    // mcp-fixture-sync guard idiom.
    const ids = listClientIds(readdirSync(CLIENTS_DIR));
    const expected = renderClientBrandingMap(ids);
    const committed = readFileSync(GENERATED_PATH, 'utf-8');
    expect(committed).toEqual(expected);
  });

  it('clients dir always contains default.json', () => {
    const ids = listClientIds(readdirSync(CLIENTS_DIR));
    expect(ids).toContain('default');
  });
});
