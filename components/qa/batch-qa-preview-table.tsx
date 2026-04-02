'use client';

import { useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QAPair {
  question: string;
  answer: string;
}

export interface BatchQAPreviewTableProps {
  /** The list of Q&A pairs to display */
  pairs: QAPair[];
  /** Callback when pairs change (edit, add, remove) */
  onPairsChange: (pairs: QAPair[]) => void;
  /** Per-item status messages (e.g. "Created", "Failed: ...") */
  itemStatuses?: Map<number, { status: 'created' | 'failed'; error?: string }>;
  /** Whether the table is in a read-only/submitting state */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PAIRS = 100;

// ---------------------------------------------------------------------------
// Parsing utilities
// ---------------------------------------------------------------------------

/**
 * Parse pasted text into Q&A pairs.
 *
 * Supports tab-separated and pipe-separated formats.
 * Each line should have a question in the first column and an answer
 * in the second column.
 */
export function parsePastedQA(text: string): QAPair[] {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines
    .map((line) => {
      // Try tab-separated first, then pipe-separated
      const parts = line.includes('\t')
        ? line.split('\t')
        : line.split('|').map((p) => p.trim());
      return {
        question: (parts[0] ?? '').trim(),
        answer: (parts[1] ?? '').trim(),
      };
    })
    .filter((pair) => pair.question && pair.answer);
}

/**
 * Format a Q&A pair into the content format expected by the batch API.
 */
export function formatQAContent(pair: QAPair): string {
  return `Q: ${pair.question}\n\nA: ${pair.answer}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Preview table for batch Q&A creation.
 *
 * Shows parsed Q&A pairs with inline editing, row add/remove, and
 * per-item status indicators.
 */
export function BatchQAPreviewTable({
  pairs,
  onPairsChange,
  itemStatuses,
  disabled = false,
}: BatchQAPreviewTableProps) {
  const [editingCell, setEditingCell] = useState<{
    row: number;
    field: 'question' | 'answer';
  } | null>(null);

  const handleCellClick = useCallback(
    (row: number, field: 'question' | 'answer') => {
      if (disabled) return;
      setEditingCell({ row, field });
    },
    [disabled],
  );

  const handleCellChange = useCallback(
    (row: number, field: 'question' | 'answer', value: string) => {
      const updated = [...pairs];
      updated[row] = { ...updated[row], [field]: value };
      onPairsChange(updated);
    },
    [pairs, onPairsChange],
  );

  const handleCellBlur = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      setEditingCell(null);
    }
  }, []);

  const handleAddRow = useCallback(() => {
    if (pairs.length >= MAX_PAIRS) return;
    onPairsChange([...pairs, { question: '', answer: '' }]);
  }, [pairs, onPairsChange]);

  const handleRemoveRow = useCallback(
    (index: number) => {
      const updated = pairs.filter((_, i) => i !== index);
      onPairsChange(updated);
    },
    [pairs, onPairsChange],
  );

  const getStatusDisplay = useCallback(
    (index: number): { text: string; className: string } => {
      const status = itemStatuses?.get(index);
      if (!status) {
        return { text: 'Ready', className: 'text-muted-foreground' };
      }
      if (status.status === 'created') {
        return { text: 'Created', className: 'text-freshness-fresh' };
      }
      return {
        text: status.error ? `Failed: ${status.error}` : 'Failed',
        className: 'text-destructive',
      };
    },
    [itemStatuses],
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table
          className="w-full text-sm"
          role="grid"
          aria-label="Q&A pairs preview"
        >
          <thead>
            <tr className="border-b bg-muted/50">
              <th
                scope="col"
                className="w-12 px-3 py-2 text-left font-medium text-muted-foreground"
              >
                #
              </th>
              <th
                scope="col"
                className="min-w-[200px] px-3 py-2 text-left font-medium text-muted-foreground"
              >
                Question
              </th>
              <th
                scope="col"
                className="min-w-[200px] px-3 py-2 text-left font-medium text-muted-foreground"
              >
                Answer
              </th>
              <th
                scope="col"
                className="w-24 px-3 py-2 text-left font-medium text-muted-foreground"
              >
                Status
              </th>
              <th scope="col" className="w-12 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair, index) => {
              const statusDisplay = getStatusDisplay(index);
              return (
                <tr
                  key={index}
                  className="border-b last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2">
                    {editingCell?.row === index &&
                    editingCell.field === 'question' ? (
                      <Input
                        value={pair.question}
                        onChange={(e) =>
                          handleCellChange(index, 'question', e.target.value)
                        }
                        onBlur={handleCellBlur}
                        onKeyDown={handleCellKeyDown}
                        autoFocus
                        aria-label={`Question ${index + 1}`}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleCellClick(index, 'question')}
                        className="w-full cursor-text truncate text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-1"
                        aria-label={`Edit question ${index + 1}: ${pair.question || 'empty'}`}
                        disabled={disabled}
                      >
                        {pair.question || (
                          <span className="text-muted-foreground italic">
                            Click to edit
                          </span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editingCell?.row === index &&
                    editingCell.field === 'answer' ? (
                      <Input
                        value={pair.answer}
                        onChange={(e) =>
                          handleCellChange(index, 'answer', e.target.value)
                        }
                        onBlur={handleCellBlur}
                        onKeyDown={handleCellKeyDown}
                        autoFocus
                        aria-label={`Answer ${index + 1}`}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleCellClick(index, 'answer')}
                        className="w-full cursor-text truncate text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-1"
                        aria-label={`Edit answer ${index + 1}: ${pair.answer || 'empty'}`}
                        disabled={disabled}
                      >
                        {pair.answer || (
                          <span className="text-muted-foreground italic">
                            Click to edit
                          </span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusDisplay.className}>
                      {statusDisplay.text}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleRemoveRow(index)}
                      disabled={disabled}
                      aria-label={`Remove row ${index + 1}`}
                    >
                      <Trash2
                        className="size-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {pairs.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No Q&A pairs yet. Paste from a spreadsheet or add rows
                  manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add row button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddRow}
        disabled={disabled || pairs.length >= MAX_PAIRS}
        className="gap-1.5"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add row
      </Button>

      {/* Pair count / limit indicator */}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {pairs.length} of {MAX_PAIRS} maximum pairs
      </p>
    </div>
  );
}
