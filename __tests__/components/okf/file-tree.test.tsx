/**
 * {132.32} G-LANDING-IMPL — `<FileTree>` (LI-15 full-bundle tree navigation,
 * LI-16 ontology.json listed-but-non-openable).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileTree } from '@/components/okf/file-tree';
import type { OkfTreeNode } from '@/lib/query/okf';

const TREE: OkfTreeNode[] = [
  { name: 'index.md', path: 'index.md', type: 'file', renderable: true },
  { name: 'log.md', path: 'log.md', type: 'file', renderable: true },
  {
    name: 'ontology.json',
    path: 'ontology.json',
    type: 'file',
    renderable: false,
  },
  {
    name: 'theme',
    path: 'theme',
    type: 'directory',
    children: [
      {
        name: 'concept.md',
        path: 'theme/concept.md',
        type: 'file',
        renderable: true,
      },
    ],
  },
];

describe('FileTree', () => {
  it('renders every file and directory node, nested files included (LI-15)', () => {
    render(
      <FileTree nodes={TREE} selectedPath={null} onSelectFile={vi.fn()} />,
    );
    expect(screen.getByText('index.md')).toBeInTheDocument();
    expect(screen.getByText('log.md')).toBeInTheDocument();
    expect(screen.getByText('ontology.json')).toBeInTheDocument();
    expect(screen.getByText('theme')).toBeInTheDocument();
    expect(screen.getByText('concept.md')).toBeInTheDocument();
  });

  it('makes renderable files openable buttons that report their path', () => {
    const onSelectFile = vi.fn();
    render(
      <FileTree nodes={TREE} selectedPath={null} onSelectFile={onSelectFile} />,
    );
    screen.getByRole('button', { name: 'index.md' }).click();
    expect(onSelectFile).toHaveBeenCalledWith('index.md');
  });

  it('marks the selected file as current', () => {
    render(
      <FileTree nodes={TREE} selectedPath="log.md" onSelectFile={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'log.md' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('renders a non-renderable file as non-openable, not a button (LI-16)', () => {
    render(
      <FileTree nodes={TREE} selectedPath={null} onSelectFile={vi.fn()} />,
    );
    expect(
      screen.queryByRole('button', { name: 'ontology.json' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('ontology.json')).toBeInTheDocument();
  });

  it('opens a nested concept file from within a theme directory', () => {
    const onSelectFile = vi.fn();
    render(
      <FileTree nodes={TREE} selectedPath={null} onSelectFile={onSelectFile} />,
    );
    screen.getByRole('button', { name: 'concept.md' }).click();
    expect(onSelectFile).toHaveBeenCalledWith('theme/concept.md');
  });
});
