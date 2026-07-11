/**
 * {132.32} G-LANDING-IMPL — full-bundle file-explorer tree walk (LI-15) +
 * render-exclusion flagging (LI-16) + traversal-safety guard (LI-17).
 * Behaviour-first over a real temp-dir bundle tree, matching the sibling
 * `bundle-graph.test.ts` fixture convention.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  walkBundleTree,
  resolveBundleTreePath,
  assertRealpathWithinBundleRoot,
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

  // Security regression (post-{132.32} Checker finding): a committed
  // symlink in the client-owned, externally-synced bundle repo (DR-016)
  // pointing OUTSIDE the bundle root must never be listed — Dirent reports
  // it as a file (isDirectory() false) with no lexical `..` in its own
  // name, so the lexical-only guard alone would have let it through.
  it('excludes a symlink pointing outside the bundle root from the tree (LI-17 security)', () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'okf-outside-'));
    const outsideSecretPath = path.join(outsideDir, 'outside-secret.md');
    writeFileSync(outsideSecretPath, 'TOP SECRET HOST CONTENT', 'utf-8');

    writeFileSync(path.join(bundleRoot, 'index.md'), '## Sales\n', 'utf-8');
    symlinkSync(outsideSecretPath, path.join(bundleRoot, 'leaked.md'));

    try {
      const tree = walkBundleTree(bundleRoot);
      const names = tree.map((n) => n.name).sort();
      expect(names).toEqual(['index.md']);
      expect(tree.some((n) => n.name === 'leaked.md')).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('excludes a symlinked directory (and never recurses into it)', () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'okf-outside-dir-'));
    writeFileSync(
      path.join(outsideDir, 'secret.md'),
      'TOP SECRET HOST CONTENT',
      'utf-8',
    );
    symlinkSync(outsideDir, path.join(bundleRoot, 'linked-dir'));

    try {
      const tree = walkBundleTree(bundleRoot);
      expect(tree.some((n) => n.name === 'linked-dir')).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  // Hygiene regression (post-{132.32} browser-verify finding): a bundle is
  // a git clone (DR-016) — its `.git/` VCS plumbing (and any other
  // dotfile/dot-directory) must never appear in the explorer tree.
  it('excludes .git and other dot-entries from the tree (hygiene)', () => {
    writeFileSync(path.join(bundleRoot, 'index.md'), '## Sales\n', 'utf-8');
    writeFileSync(path.join(bundleRoot, '.hidden.md'), 'hidden', 'utf-8');
    mkdirSync(path.join(bundleRoot, '.git', 'objects', 'pack'), {
      recursive: true,
    });
    writeFileSync(path.join(bundleRoot, '.git', 'config'), '[core]', 'utf-8');
    writeFileSync(
      path.join(bundleRoot, '.git', 'HEAD'),
      'ref: refs/heads/main',
      'utf-8',
    );
    mkdirSync(path.join(bundleRoot, '.git', 'hooks'), { recursive: true });
    writeFileSync(
      path.join(bundleRoot, '.git', 'hooks', 'pre-commit.sample'),
      '#!/bin/sh',
      'utf-8',
    );
    writeFileSync(
      path.join(bundleRoot, '.git', 'objects', 'pack', 'pack-abc.pack'),
      'binary',
      'utf-8',
    );

    const tree = walkBundleTree(bundleRoot);
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual(['index.md']);
    expect(tree.some((n) => n.name === '.git')).toBe(false);
    expect(tree.some((n) => n.name === '.hidden.md')).toBe(false);
  });
});

describe('assertRealpathWithinBundleRoot (LI-17 symlink-target hardening, security fix)', () => {
  let bundleRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    bundleRoot = mkdtempSync(path.join(tmpdir(), 'okf-realpath-'));
    outsideDir = mkdtempSync(path.join(tmpdir(), 'okf-realpath-outside-'));
  });

  afterEach(() => {
    rmSync(bundleRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('does not throw for a real (non-symlink) file within the bundle root', () => {
    const filePath = path.join(bundleRoot, 'index.md');
    writeFileSync(filePath, '## Sales\n', 'utf-8');
    expect(() =>
      assertRealpathWithinBundleRoot(bundleRoot, filePath),
    ).not.toThrow();
  });

  it('does not throw for a path that does not exist yet (a 404 concern, not a containment violation)', () => {
    expect(() =>
      assertRealpathWithinBundleRoot(
        bundleRoot,
        path.join(bundleRoot, 'does-not-exist.md'),
      ),
    ).not.toThrow();
  });

  it('rejects a symlink whose real target resolves outside the bundle root — the checker PoC', () => {
    const outsideSecretPath = path.join(outsideDir, 'outside-secret.md');
    writeFileSync(outsideSecretPath, 'TOP SECRET HOST CONTENT', 'utf-8');
    const leakedPath = path.join(bundleRoot, 'leaked.md');
    symlinkSync(outsideSecretPath, leakedPath);

    expect(() =>
      assertRealpathWithinBundleRoot(bundleRoot, leakedPath),
    ).toThrow(/escapes bundle root/);
  });

  it('does not throw for a symlink whose real target resolves within the bundle root', () => {
    const realPath = path.join(bundleRoot, 'real-concept.md');
    writeFileSync(realPath, 'body', 'utf-8');
    const linkPath = path.join(bundleRoot, 'alias.md');
    symlinkSync(realPath, linkPath);

    expect(() =>
      assertRealpathWithinBundleRoot(bundleRoot, linkPath),
    ).not.toThrow();
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

  it('rejects a symlink whose real target resolves outside the bundle root (LI-17 security)', () => {
    const outsideDir = mkdtempSync(
      path.join(tmpdir(), 'okf-tree-path-outside-'),
    );
    const outsideSecretPath = path.join(outsideDir, 'outside-secret.md');
    writeFileSync(outsideSecretPath, 'TOP SECRET HOST CONTENT', 'utf-8');
    symlinkSync(outsideSecretPath, path.join(bundleRoot, 'leaked.md'));

    try {
      expect(() => resolveBundleTreePath(bundleRoot, 'leaked.md')).toThrow(
        /escapes bundle root/,
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
