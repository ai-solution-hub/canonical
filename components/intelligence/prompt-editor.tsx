'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pencil, Save, X } from 'lucide-react';
import type { FeedPrompt } from '@/hooks/intelligence/use-feed-prompts';

interface PromptEditorProps {
  workspaceId: string;
  currentPrompt: FeedPrompt | null;
  /** Text to display when viewing a historical version (read-only) */
  viewingText?: string | null;
  isAdmin: boolean;
  onSave: (data: { prompt_text: string; change_notes?: string }) => void;
  isSaving: boolean;
}

export function PromptEditor({
  currentPrompt,
  viewingText,
  isAdmin,
  onSave,
  isSaving,
}: PromptEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [changeNotes, setChangeNotes] = useState('');

  const displayText = viewingText ?? currentPrompt?.prompt_text ?? '';
  const isViewingHistory = viewingText !== undefined && viewingText !== null;

  function handleStartEdit() {
    setPromptText(currentPrompt?.prompt_text ?? '');
    setChangeNotes('');
    setIsEditing(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setPromptText('');
    setChangeNotes('');
  }

  function handleSave() {
    if (!promptText.trim() || !changeNotes.trim()) return;
    onSave({
      prompt_text: promptText,
      change_notes: changeNotes,
    });
    setIsEditing(false);
    setPromptText('');
    setChangeNotes('');
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Filter rules
          </h2>
          {currentPrompt && (
            <p className="text-xs text-muted-foreground">
              Version {currentPrompt.version}
              {isViewingHistory && ' (viewing historical version)'}
            </p>
          )}
        </div>
        {isAdmin && !isEditing && !isViewingHistory && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleStartEdit}
            className="gap-1.5"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
        )}
        {isEditing && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="gap-1.5"
            >
              <X className="size-3.5" aria-hidden="true" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !promptText.trim() || !changeNotes.trim()}
              className="gap-1.5"
            >
              <Save className="size-3.5" aria-hidden="true" />
              {isSaving ? 'Saving...' : 'Save New Version'}
            </Button>
          </div>
        )}
      </div>

      {/* Prompt text area */}
      <Textarea
        value={isEditing ? promptText : displayText}
        onChange={(e) => isEditing && setPromptText(e.target.value)}
        readOnly={!isEditing}
        rows={16}
        className="font-mono text-sm"
        placeholder="Enter the relevance rules..."
        aria-label="Prompt text"
      />

      {/* Change notes field (visible only when editing) */}
      {isEditing && (
        <div className="space-y-1.5">
          <Label htmlFor="change-notes" className="text-sm font-medium">
            Change notes <span className="text-destructive">*</span>
          </Label>
          <Input
            id="change-notes"
            value={changeNotes}
            onChange={(e) => setChangeNotes(e.target.value)}
            placeholder="Describe what changed and why..."
            maxLength={1000}
          />
        </div>
      )}

      {/* Explanation text */}
      {!isEditing && (
        <p className="text-xs text-muted-foreground">
          These rules determine which articles are kept in this workspace&apos;s
          feed. Saving creates a new version that takes effect on the next
          refresh.
        </p>
      )}
    </div>
  );
}
