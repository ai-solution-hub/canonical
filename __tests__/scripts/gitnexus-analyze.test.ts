/**
 * Vitest unit tests for `scripts/gitnexus-analyze.ts` (ID-68.31, PC-21).
 *
 * The wrapper guards the two tracked harness files (CLAUDE.md, AGENTS.md)
 * against the `gitnexus analyze` stat-block auto-rewrite that reintroduces
 * live symbol/relationship/flow counts forbidden by PRODUCT Inv 21
 * (docs/specs/ID-68-repo-visibility-ip-separation/PRODUCT.md).
 *
 * Covers:
 *   - buildAnalyzeArgs: injects `--no-stats`, no duplication, passthrough order
 *   - snapshotHarnessFiles: captures content + existence per harness file
 *   - restoreHarnessFiles: byte-identical restore on mutation, deletion of
 *     analyze-created files, re-creation of analyze-deleted files, no-op when
 *     clean
 *   - runGuardedAnalyze: end-to-end with a command override that mutates the
 *     harness files; exit-code passthrough; restore-on-failure
 *
 * The real `npx gitnexus analyze` is never spawned — the `command` seam
 * substitutes a deterministic mutator. Live proof on the primary tree is the
 * Orchestrator's post-merge step (worktrees inherit no `.gitnexus` index).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HARNESS_FILES,
  buildAnalyzeArgs,
  snapshotHarnessFiles,
  restoreHarnessFiles,
  runGuardedAnalyze,
} from '../../scripts/gitnexus-analyze';

const CLAUDE_FIXTURE = [
  '# CLAUDE.md',
  '',
  'Project guidance.',
  '',
  '<!-- gitnexus:start -->',
  '# GitNexus — Code Intelligence',
  '',
  'This project is indexed by GitNexus as **knowledge-hub**. Use the GitNexus MCP tools.',
  '<!-- gitnexus:end -->',
  '',
].join('\n');

const AGENTS_FIXTURE = [
  '# AGENTS.md',
  '',
  'Agent guidance.',
  '',
  '<!-- gitnexus:start -->',
  '# GitNexus — Code Intelligence',
  '',
  'This project is indexed by GitNexus as **knowledge-hub**. Use the GitNexus MCP tools.',
  '<!-- gitnexus:end -->',
  '',
].join('\n');

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitnexus-analyze-test-'));
  fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), CLAUDE_FIXTURE, 'utf-8');
  fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), AGENTS_FIXTURE, 'utf-8');
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('HARNESS_FILES', () => {
  it('guards exactly CLAUDE.md and AGENTS.md', () => {
    expect([...HARNESS_FILES]).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });
});

describe('buildAnalyzeArgs', () => {
  it('injects --no-stats after analyze and before passthrough args', () => {
    expect(buildAnalyzeArgs([])).toEqual(['analyze', '--no-stats']);
  });

  it('preserves passthrough args', () => {
    expect(buildAnalyzeArgs(['--force', '--skills'])).toEqual([
      'analyze',
      '--no-stats',
      '--force',
      '--skills',
    ]);
  });

  it('does not duplicate --no-stats when caller already passed it', () => {
    expect(buildAnalyzeArgs(['--no-stats', '--force'])).toEqual([
      'analyze',
      '--no-stats',
      '--force',
    ]);
  });
});

describe('snapshotHarnessFiles', () => {
  it('captures content for existing harness files', () => {
    const snapshots = snapshotHarnessFiles(repoRoot);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual({
      file: 'CLAUDE.md',
      existed: true,
      content: CLAUDE_FIXTURE,
    });
    expect(snapshots[1]).toEqual({
      file: 'AGENTS.md',
      existed: true,
      content: AGENTS_FIXTURE,
    });
  });

  it('records non-existence when a harness file is absent', () => {
    fs.rmSync(path.join(repoRoot, 'AGENTS.md'));
    const snapshots = snapshotHarnessFiles(repoRoot);
    expect(snapshots[1]).toEqual({
      file: 'AGENTS.md',
      existed: false,
      content: null,
    });
  });
});

describe('restoreHarnessFiles', () => {
  it('restores a mutated file byte-identical and reports it', () => {
    const snapshots = snapshotHarnessFiles(repoRoot);
    const mutated = CLAUDE_FIXTURE.replace(
      '**knowledge-hub**.',
      '**knowledge-hub** (47894 symbols, 71003 relationships, 300 execution flows).',
    );
    fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), mutated, 'utf-8');

    const restored = restoreHarnessFiles(repoRoot, snapshots);

    expect(restored).toEqual(['CLAUDE.md']);
    expect(fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8')).toBe(
      CLAUDE_FIXTURE,
    );
    expect(fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf-8')).toBe(
      AGENTS_FIXTURE,
    );
  });

  it('returns an empty list and leaves files untouched when nothing drifted', () => {
    const snapshots = snapshotHarnessFiles(repoRoot);
    const restored = restoreHarnessFiles(repoRoot, snapshots);
    expect(restored).toEqual([]);
    expect(fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8')).toBe(
      CLAUDE_FIXTURE,
    );
    expect(fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf-8')).toBe(
      AGENTS_FIXTURE,
    );
  });

  it('removes a harness file the run created when it did not exist pre-run', () => {
    fs.rmSync(path.join(repoRoot, 'AGENTS.md'));
    const snapshots = snapshotHarnessFiles(repoRoot);
    fs.writeFileSync(
      path.join(repoRoot, 'AGENTS.md'),
      'analyze-created content\n',
      'utf-8',
    );

    const restored = restoreHarnessFiles(repoRoot, snapshots);

    expect(restored).toEqual(['AGENTS.md']);
    expect(fs.existsSync(path.join(repoRoot, 'AGENTS.md'))).toBe(false);
  });

  it('re-creates a harness file the run deleted', () => {
    const snapshots = snapshotHarnessFiles(repoRoot);
    fs.rmSync(path.join(repoRoot, 'CLAUDE.md'));

    const restored = restoreHarnessFiles(repoRoot, snapshots);

    expect(restored).toEqual(['CLAUDE.md']);
    expect(fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8')).toBe(
      CLAUDE_FIXTURE,
    );
  });

  it('does not touch non-harness files', () => {
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'readme\n', 'utf-8');
    const snapshots = snapshotHarnessFiles(repoRoot);
    fs.writeFileSync(
      path.join(repoRoot, 'README.md'),
      'changed by analyze\n',
      'utf-8',
    );

    const restored = restoreHarnessFiles(repoRoot, snapshots);

    expect(restored).toEqual([]);
    expect(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf-8')).toBe(
      'changed by analyze\n',
    );
  });
});

describe('runGuardedAnalyze', () => {
  /** A command that appends a stat-block rewrite to both harness files. */
  const mutatorCommand = (exitCode = 0): string[] => [
    'node',
    '-e',
    [
      "const fs = require('node:fs');",
      "fs.appendFileSync('CLAUDE.md', 'REWRITTEN (1 symbols, 2 relationships, 3 execution flows)\\n');",
      "fs.appendFileSync('AGENTS.md', 'REWRITTEN (1 symbols, 2 relationships, 3 execution flows)\\n');",
      `process.exit(${exitCode});`,
    ].join(' '),
  ];

  it('leaves both harness files byte-identical after a mutating run', () => {
    const result = runGuardedAnalyze({
      repoRoot,
      passthroughArgs: [],
      command: mutatorCommand(0),
    });

    expect(result.exitCode).toBe(0);
    expect(result.restored.sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8')).toBe(
      CLAUDE_FIXTURE,
    );
    expect(fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf-8')).toBe(
      AGENTS_FIXTURE,
    );
  });

  it('reports no restores when the run does not touch harness files', () => {
    const result = runGuardedAnalyze({
      repoRoot,
      passthroughArgs: [],
      command: ['node', '-e', 'process.exit(0);'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.restored).toEqual([]);
  });

  it('passes through a non-zero exit code and still restores', () => {
    const result = runGuardedAnalyze({
      repoRoot,
      passthroughArgs: [],
      command: mutatorCommand(3),
    });

    expect(result.exitCode).toBe(3);
    expect(result.restored.sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8')).toBe(
      CLAUDE_FIXTURE,
    );
  });
});
