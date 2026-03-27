'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

interface BidCreationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bid: { id: string; name: string }) => void;
}

export function BidCreationForm({ open, onOpenChange, onCreated }: BidCreationFormProps) {
  const [name, setName] = useState('');
  const [buyer, setBuyer] = useState('');
  const [deadline, setDeadline] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName('');
    setBuyer('');
    setDeadline('');
    setReferenceNumber('');
    setEstimatedValue('');
    setNotes('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, string | undefined> = {
        name: name.trim(),
        buyer: buyer.trim(),
      };
      if (deadline) {
        // Convert date input (YYYY-MM-DD) to ISO datetime with 17:00 UTC
        body.deadline = `${deadline}T17:00:00Z`;
      }
      if (referenceNumber.trim()) body.reference_number = referenceNumber.trim();
      if (estimatedValue.trim()) body.estimated_value = estimatedValue.trim();
      if (notes.trim()) body.notes = notes.trim();

      const response = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create bid (${response.status})`);
      }

      const created = await response.json();
      resetForm();
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bid');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) resetForm();
      onOpenChange(isOpen);
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Bid</DialogTitle>
          <DialogDescription>
            Set up a new bid workspace. You can upload tender documents after creation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Bid Name */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-name">
              Bid Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="bid-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NHS Trust ITT 2026"
              required
              maxLength={200}
              disabled={saving}
              autoFocus
            />
          </div>

          {/* Buyer */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-buyer">
              Buyer / Issuing Organisation <span className="text-destructive">*</span>
            </Label>
            <Input
              id="bid-buyer"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              placeholder="e.g. NHS Digital"
              required
              maxLength={200}
              disabled={saving}
            />
          </div>

          {/* Deadline */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-deadline">Submission Deadline</Label>
            <Input
              id="bid-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Reference Number */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-reference">Reference Number</Label>
            <Input
              id="bid-reference"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="e.g. ITT-2026-042"
              maxLength={100}
              disabled={saving}
            />
          </div>

          {/* Estimated Value */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-value">Estimated Value</Label>
            <Input
              id="bid-value"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="e.g. £50,000"
              maxLength={100}
              disabled={saving}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="bid-notes">Notes</Label>
            <Textarea
              id="bid-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about this bid"
              maxLength={5000}
              rows={3}
              disabled={saving}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !buyer.trim()}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                'Create Bid'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
