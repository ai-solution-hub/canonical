'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { VALID_CONTENT_TYPES } from '@/lib/validation/schemas';
import { cn } from '@/lib/utils';

const FRESHNESS_VALUES = ['fresh', 'aging', 'stale', 'expired'] as const;

interface TeamMember {
  id: string;
  email: string;
  display_name?: string;
}

interface ReviewAssignment {
  id: string;
  reviewer_id: string;
  assigned_by: string;
  assignment_type: string;
  filter_domains: string[];
  filter_content_types: string[];
  filter_freshness: string[];
  filter_date_from: string | null;
  filter_date_to: string | null;
  item_count: number | null;
  status: string;
  notes: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentManagerProps {
  className?: string;
}

/**
 * Admin-only component for creating and managing review assignments.
 * Allows selecting a reviewer, filter criteria, and optional due date.
 */
export function AssignmentManager({ className }: AssignmentManagerProps) {
  const { getDomainNames } = useTaxonomy();
  const domainNames = getDomainNames();

  // Team members for reviewer selection
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  // Existing assignments
  const [assignments, setAssignments] = useState<ReviewAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);

  // Form state
  const [selectedReviewer, setSelectedReviewer] = useState('');
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [selectedContentTypes, setSelectedContentTypes] = useState<string[]>([]);
  const [selectedFreshness, setSelectedFreshness] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  // Estimated item count
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch team members
  useEffect(() => {
    async function loadMembers() {
      try {
        const res = await fetch('/api/entities/users');
        if (!res.ok) throw new Error('Failed to fetch team members');
        const data = await res.json();
        setTeamMembers(
          (data ?? []).map((u: { id: string; email: string; display_name?: string }) => ({
            id: u.id,
            email: u.email,
            display_name: u.display_name,
          })),
        );
      } catch (err) {
        console.error('Failed to load team members:', err);
        toast.error('Failed to load team members');
      } finally {
        setIsLoadingMembers(false);
      }
    }
    loadMembers();
  }, []);

  // Fetch existing assignments
  const loadAssignments = useCallback(async () => {
    try {
      const res = await fetch('/api/review/assignments?status=all');
      if (!res.ok) throw new Error('Failed to fetch assignments');
      const data = await res.json();
      setAssignments(data.assignments ?? []);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setIsLoadingAssignments(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  // Estimate item count when filters change
  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsCountLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('status', 'unverified');
        params.set('limit', '1');
        for (const d of selectedDomains) {
          params.append('domain', d);
        }
        for (const ct of selectedContentTypes) {
          params.append('content_type', ct);
        }
        const res = await fetch(`/api/review/queue?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setEstimatedCount(data.total ?? 0);
        }
      } catch {
        setEstimatedCount(null);
      } finally {
        setIsCountLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedDomains, selectedContentTypes, selectedFreshness]);

  // Toggle helpers for multi-select
  function toggleDomain(domain: string) {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain],
    );
  }

  function toggleContentType(ct: string) {
    setSelectedContentTypes((prev) =>
      prev.includes(ct) ? prev.filter((c) => c !== ct) : [...prev, ct],
    );
  }

  function toggleFreshness(f: string) {
    setSelectedFreshness((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  }

  // Create assignment
  async function handleCreate() {
    if (!selectedReviewer) {
      toast.error('Please select a reviewer');
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        reviewer_id: selectedReviewer,
        filter_domains: selectedDomains,
        filter_content_types: selectedContentTypes,
        filter_freshness: selectedFreshness,
      };

      if (dueDate) {
        body.due_date = new Date(dueDate).toISOString();
      }
      if (notes.trim()) {
        body.notes = notes.trim();
      }

      const res = await fetch('/api/review/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to create assignment');
      }

      toast.success('Review assignment created');

      // Reset form
      setSelectedReviewer('');
      setSelectedDomains([]);
      setSelectedContentTypes([]);
      setSelectedFreshness([]);
      setDueDate('');
      setNotes('');
      setEstimatedCount(null);

      // Reload assignments
      loadAssignments();
    } catch (err) {
      console.error('Failed to create assignment:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create assignment');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Update assignment status
  async function handleUpdateStatus(assignmentId: string, status: 'completed' | 'cancelled') {
    try {
      const res = await fetch('/api/review/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assignmentId, status }),
      });

      if (!res.ok) throw new Error('Failed to update assignment');

      toast.success(`Assignment ${status}`);
      loadAssignments();
    } catch (err) {
      console.error('Failed to update assignment:', err);
      toast.error('Failed to update assignment');
    }
  }

  // Resolve reviewer name
  function getReviewerName(reviewerId: string): string {
    const member = teamMembers.find((m) => m.id === reviewerId);
    return member?.display_name ?? member?.email ?? reviewerId.slice(0, 8);
  }

  const activeAssignments = assignments.filter((a) => a.status === 'active');
  const pastAssignments = assignments.filter((a) => a.status !== 'active');

  return (
    <div className={cn('space-y-6', className)}>
      {/* Create Assignment Form */}
      <Card>
        <CardHeader>
          <CardTitle>Create Review Assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Reviewer selection */}
          <div className="space-y-2">
            <Label htmlFor="reviewer-select">Reviewer</Label>
            {isLoadingMembers ? (
              <p className="text-sm text-muted-foreground">Loading team members...</p>
            ) : (
              <Select value={selectedReviewer} onValueChange={setSelectedReviewer}>
                <SelectTrigger id="reviewer-select" className="w-full">
                  <SelectValue placeholder="Select a reviewer" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.display_name ?? member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Domain filter */}
          <div className="space-y-2">
            <Label>Domains</Label>
            <p className="text-xs text-muted-foreground">
              Leave empty to include all domains
            </p>
            <div className="flex flex-wrap gap-2">
              {domainNames.map((domain) => (
                <label
                  key={domain}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedDomains.includes(domain)}
                    onCheckedChange={() => toggleDomain(domain)}
                    aria-label={`Filter by ${domain}`}
                  />
                  {domain}
                </label>
              ))}
            </div>
          </div>

          {/* Content type filter */}
          <div className="space-y-2">
            <Label>Content Types</Label>
            <p className="text-xs text-muted-foreground">
              Leave empty to include all content types
            </p>
            <div className="flex flex-wrap gap-2">
              {VALID_CONTENT_TYPES.map((ct) => (
                <label
                  key={ct}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedContentTypes.includes(ct)}
                    onCheckedChange={() => toggleContentType(ct)}
                    aria-label={`Filter by ${ct.replace(/_/g, ' ')}`}
                  />
                  {ct.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          </div>

          {/* Freshness filter */}
          <div className="space-y-2">
            <Label>Freshness</Label>
            <p className="text-xs text-muted-foreground">
              Leave empty to include all freshness states
            </p>
            <div className="flex flex-wrap gap-2">
              {FRESHNESS_VALUES.map((f) => (
                <label
                  key={f}
                  className="flex items-center gap-1.5 text-sm cursor-pointer capitalize"
                >
                  <Checkbox
                    checked={selectedFreshness.includes(f)}
                    onCheckedChange={() => toggleFreshness(f)}
                    aria-label={`Filter by ${f}`}
                  />
                  {f}
                </label>
              ))}
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-2">
            <Label htmlFor="due-date-input">Due Date (optional)</Label>
            <Input
              id="due-date-input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-48"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="assignment-notes">Notes (optional)</Label>
            <Input
              id="assignment-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder="e.g. Focus on items imported from tender X"
            />
          </div>

          {/* Estimated count */}
          <div className="text-sm text-muted-foreground">
            {isCountLoading ? (
              'Estimating matching items...'
            ) : estimatedCount !== null ? (
              <span>
                Estimated items: <strong>{estimatedCount}</strong>
              </span>
            ) : null}
          </div>

          {/* Submit */}
          <Button
            onClick={handleCreate}
            disabled={!selectedReviewer || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Assignment'}
          </Button>
        </CardContent>
      </Card>

      {/* Active Assignments */}
      {activeAssignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeAssignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-4 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {getReviewerName(a.reviewer_id)}
                    </p>
                    {a.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {a.notes}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {a.filter_domains?.map((d: string) => (
                        <span key={d} className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                          {d}
                        </span>
                      ))}
                      {a.filter_content_types?.map((ct: string) => (
                        <span key={ct} className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                          {ct.replace(/_/g, ' ')}
                        </span>
                      ))}
                      {a.filter_freshness?.map((f: string) => (
                        <span key={f} className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs capitalize">
                          {f}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {a.item_count ?? 0} items
                      {a.due_date && ` · Due ${new Date(a.due_date).toLocaleDateString('en-GB')}`}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpdateStatus(a.id, 'completed')}
                    >
                      Complete
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpdateStatus(a.id, 'cancelled')}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past Assignments */}
      {!isLoadingAssignments && pastAssignments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pastAssignments.slice(0, 10).map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-4 rounded-md border p-3 opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {getReviewerName(a.reviewer_id)}
                      <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                        {a.status}
                      </span>
                    </p>
                    {a.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {a.notes}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {a.item_count ?? 0} items
                      {a.completed_at && ` · Completed ${new Date(a.completed_at).toLocaleDateString('en-GB')}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
