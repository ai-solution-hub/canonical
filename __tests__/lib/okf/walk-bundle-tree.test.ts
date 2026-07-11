/**
 * {132.32} G-LANDING-IMPL — full-bundle file-explorer tree walk (LI-15) +
 * render-exclusion flagging (LI-16) + traversal-safety guard (LI-17).
 * Behaviour-first over a real temp-dir bundle tree, matching the sibling
 * `bundle-graph.test.ts` fixture convention.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  walkBundleTree,
  resolveBundleTreePath,
} from '@/lib/okf/walk-bundle-tree';

describe('walkBundleTree', () => {
  let bundleRoot: string;

  beforeEach(() => {
    bundleRoot = mkdtempSync(path.join(tmpdir(), 'okf-walk-tree-'));
  });

  afterEach(() => {
    rmSync(bundleRoot, { recursive: true, force: true });
  });

  it('lists index.md, a nested concept, log.md, and ontology.json (LI-15)', () => {
    writeFileSync(path.join(bundleRoot, 'index.md'), '## Sales\n', 'utf-8');
    writeFileSync(path.join(bundleRoot, 'log.md'), '## run\n', 'utf-8');
    writeFileSync(
      path.join(bundleRoot, 'ontology.json'),
      '{"concepts":[]}',
      'utf-8',
    );
    mkdirSync(path.join(bundleRoot, 'theme'));
    writeFileSync(
      path.join(bundleRoot, 'theme', 'concept.md'),
      '---\ntitle: Concept\n---\nBody.',
      'utf-8',
    );

    const tree = walkBundleTree(bundleRoot);
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual(['index.md', 'log.md', 'ontology.json', 'theme']);

    const themeNode = tree.find((n) => n.name === 'theme')!;
    expect(themeNode.type).toBe('directory');
    expect(themeNode.children).toHaveLength(1);
    expect(themeNode.children![0].name).toBe('concept.md');
    expect(themeNode.children![0].path).toBe('theme/concept.md');
    expect(themeNode.children![0].renderable).toBe(true);
  });

  it('flags ontology.json as non-renderable but still listed (LI-16)', () => {
    writeFileSync(
      path.join(bundleRoot, 'ontology.json'),
      '{"concepts":[]}',
      'utf-8',
    );
    const tree = walkBundleTree(bundleRoot);
    const ontology = tree.find((n) => n.name === 'ontology.json')!;
    expect(ontology.type).toBe('file');
    expect(ontology.renderable).toBe(false);
  });

  it('flags every markdown file as renderable', () => {
    writeFileSync(path.join(bundleRoot, 'index.md'), '## Sales\n', 'utf-8');
    const tree = walkBundleTree(bundleRoot);
    expect(tree.find((n) => n.name === 'index.md')!.renderable).toBe(true);
  });

  it('returns [] for an empty bundle root', () => {
    expect(walkBundleTree(bundleRoot)).toEqual([]);
  });

  it('uses POSIX-separated relative paths for nested files', () => {
    mkdirSync(path.join(bundleRoot, 'a', 'b'), { recursive: true });
    writeFileSync(path.join(bundleRoot, 'a', 'b', 'c.md'), 'body', 'utf-8');
    const tree = walkBundleTree(bundleRoot);
    const aNode = tree.find((n) => n.name === 'a')!;
    const bNode = aNode.children!.find((n) => n.name === 'b')!;
    expect(bNode.children![0].path).toBe('a/b/c.md');
  });
});

describe('resolveBundleTreePath (LI-17 traversal-safety guard)', () => {
  let bundleRoot: string;

  beforeEach(() => {
    bundleRoot = mkdtempSync(path.join(tmpdir(), 'okf-tree-path-'));
    mkdirSync(path.join(bundleRoot, 'theme'));
    writeFileSync(
      path.join(bundleRoot, 'theme', 'concept.md'),
      'body',
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(bundleRoot, { recursive: true, force: true });
  });

  it('resolves a within-tree relative path', () => {
    expect(resolveBundleTreePath(bundleRoot, 'theme/concept.md')).toBe(
      path.join(path.resolve(bundleRoot), 'theme', 'concept.md'),
    );
  });

  it('rejects a parent-traversal path (../../etc/passwd)', () => {
    expect(() => resolveBundleTreePath(bundleRoot, '../../etc/passwd')).toThrow(
      /escapes bundle root/,
    );
  });

  it('rejects an absolute path', () => {
    expect(() => resolveBundleTreePath(bundleRoot, '/etc/passwd')).toThrow(
      /escapes bundle root/,
    );
  });

  it('rejects a path that resolves to the bundle root itself', () => {
    expect(() => resolveBundleTreePath(bundleRoot, '.')).toThrow(
      /escapes bundle root/,
    );
  });

  it('rejects a sibling-directory escape disguised with a valid prefix', () => {
    expect(() => resolveBundleTreePath(bundleRoot, '../evil.md')).toThrow(
      /escapes bundle root/,
    );
  });
});
