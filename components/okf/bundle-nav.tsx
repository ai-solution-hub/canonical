'use client';

/**
 * `<BundleNav>` — the `index.md` three-level progressive-disclosure nav rail
 * (ID-132 {132.14} G-VIEWER NATIVE ADDITION; TECH-ADDENDUM-reference-agents.md
 * Part 2 §"Operationally defining 'progressive disclosure' for index.md").
 *
 * Level 1: theme headings, collapsed by default. Level 2: expanding a theme
 * reveals its concept entries as `title — description` rows. Level 3: a full
 * concept detail is `<ConceptDetail>`'s job — clicking a row here only
 * selects the concept id via `onSelectConcept`.
 *
 * Soft-dep `{132.10}`: when `themes` is `null` (index.md absent), falls back
 * to grouping the concept graph's nodes by `type` — a flatter two-level
 * disclosure, but never hard-blocked on `{132.10}` landing.
 */
import { useMemo } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import type { OkfBundleGraphNode, OkfBundleNavTheme } from '@/lib/query/okf';

interface NavRow {
  title: string;
  path: string;
  description: string;
}

interface NavGroup {
  key: string;
  heading: string;
  concepts: NavRow[];
  children: NavGroup[];
}

function themesToGroups(themes: OkfBundleNavTheme[]): NavGroup[] {
  return themes.map((theme, i) => ({
    key: `${theme.heading}-${i}`,
    heading: theme.heading,
    concepts: theme.concepts,
    children: theme.children.map((child, j) => ({
      key: `${theme.heading}-${i}-${child.heading}-${j}`,
      heading: child.heading,
      concepts: child.concepts,
      children: [],
    })),
  }));
}

/** Fallback: group the concept graph's nodes by `type` when `index.md` is absent. */
function nodesToGroups(nodes: OkfBundleGraphNode[]): NavGroup[] {
  const byType = new Map<string, NavRow[]>();
  for (const node of nodes) {
    const list = byType.get(node.data.type) ?? [];
    list.push({
      title: node.data.label,
      path: node.data.id,
      description: node.data.description,
    });
    byType.set(node.data.type, list);
  }
  return Array.from(byType.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, concepts]) => ({
      key: type,
      heading: type,
      concepts: concepts.sort((a, b) => a.title.localeCompare(b.title)),
      children: [],
    }));
}

interface BundleNavProps {
  /** The parsed `index.md` nav tree, or `null` when `index.md` is absent (soft-dep `{132.10}`). */
  themes: OkfBundleNavTheme[] | null;
  /** The concept graph's nodes — used for the type-grouping fallback when `themes` is `null`. */
  fallbackNodes: OkfBundleGraphNode[];
  selectedConceptId: string | null;
  onSelectConcept: (conceptId: string) => void;
  className?: string;
}

function ConceptRow({
  row,
  selected,
  onSelect,
}: {
  row: NavRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        selected
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground hover:bg-accent/50',
      )}
    >
      <span className="font-medium">{row.title}</span>
      {row.description && (
        <span className="text-muted-foreground"> — {row.description}</span>
      )}
    </button>
  );
}

export function BundleNav({
  themes,
  fallbackNodes,
  selectedConceptId,
  onSelectConcept,
  className,
}: BundleNavProps) {
  const groups = useMemo(
    () => (themes ? themesToGroups(themes) : nodesToGroups(fallbackNodes)),
    [themes, fallbackNodes],
  );

  if (groups.length === 0) {
    return (
      <div className={cn('p-4 text-sm text-muted-foreground', className)}>
        No concepts in this bundle yet.
      </div>
    );
  }

  return (
    <nav
      aria-label="Bundle contents"
      data-testid="bundle-nav"
      className={cn('overflow-y-auto p-2', className)}
    >
      <Accordion type="multiple" className="w-full">
        {groups.map((group) => (
          <AccordionItem key={group.key} value={group.key}>
            <AccordionTrigger className="text-sm font-semibold">
              {group.heading}
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {group.concepts.map((row) => (
                  <ConceptRow
                    key={row.path}
                    row={row}
                    selected={row.path === selectedConceptId}
                    onSelect={() => onSelectConcept(row.path)}
                  />
                ))}
                {group.children.map((child) => (
                  <div key={child.key} className="pl-2 pt-1">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {child.heading}
                    </div>
                    <div className="space-y-1 pt-1">
                      {child.concepts.map((row) => (
                        <ConceptRow
                          key={row.path}
                          row={row}
                          selected={row.path === selectedConceptId}
                          onSelect={() => onSelectConcept(row.path)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </nav>
  );
}
