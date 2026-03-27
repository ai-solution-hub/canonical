'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, User, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface UserOption {
  id: string;
  display_name: string | null;
  email: string;
  role: string;
}

interface ContentOwnerSelectorProps {
  itemId: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  onOwnerChanged?: (ownerId: string | null) => void;
  disabled?: boolean;
}

/**
 * Combobox for assigning a content owner to a knowledge base item.
 *
 * Fetches users with editor/admin roles and allows selection or clearing.
 * Uses the same Popover pattern as WorkspaceSelector.
 */
export function ContentOwnerSelector({
  itemId,
  currentOwnerId,
  currentOwnerName,
  onOwnerChanged,
  disabled = false,
}: ContentOwnerSelectorProps) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(currentOwnerId);
  const [selectedName, setSelectedName] = useState<string | null>(currentOwnerName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with prop changes
  useEffect(() => {
    setSelectedId(currentOwnerId);
    setSelectedName(currentOwnerName);
  }, [currentOwnerId, currentOwnerName]);

  // Fetch users with editor/admin roles when popover opens
  useEffect(() => {
    if (!open) return;

    const fetchUsers = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/users');
        if (res.ok) {
          const allUsers: UserOption[] = await res.json();
          // Only show editors and admins — they can own content
          const eligible = allUsers.filter(
            (u) => u.role === 'admin' || u.role === 'editor',
          );
          setUsers(eligible);
        } else {
          // Fallback: try to show at least the current owner
          console.error('Failed to fetch users — status', res.status);
        }
      } catch (err) {
        console.error('Failed to load users:', err);
        toast.error('Failed to load users');
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [open]);

  const handleSelect = async (user: UserOption | null) => {
    const newOwnerId = user?.id ?? null;
    const newOwnerName = user
      ? user.display_name || user.email
      : null;

    // Optimistic update
    setSelectedId(newOwnerId);
    setSelectedName(newOwnerName);
    setOpen(false);
    setSaving(true);

    try {
      const res = await fetch(`/api/items/${itemId}/owner`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: newOwnerId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update owner');
      }

      toast(newOwnerName ? `Owner set to ${newOwnerName}` : 'Owner cleared', {
        duration: 1500,
      });
      onOwnerChanged?.(newOwnerId);
    } catch (err) {
      // Rollback
      setSelectedId(currentOwnerId);
      setSelectedName(currentOwnerName);
      toast.error(
        err instanceof Error ? err.message : 'Failed to update owner',
      );
    } finally {
      setSaving(false);
    }
  };

  const filtered = users.filter((u) => {
    const searchLower = search.toLowerCase();
    return (
      (u.display_name?.toLowerCase().includes(searchLower) ?? false) ||
      u.email.toLowerCase().includes(searchLower)
    );
  });

  const displayLabel = selectedName ?? 'Unassigned';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || saving}
          className={cn(
            'h-7 w-fit gap-1.5 border-dashed text-xs',
            selectedId
              ? 'text-foreground'
              : 'text-muted-foreground',
          )}
          aria-label={`Content owner: ${displayLabel}. Click to change.`}
        >
          <User className="size-3.5" aria-hidden="true" />
          {saving ? 'Saving...' : displayLabel}
          <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          ref={inputRef}
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 h-8 text-sm"
          aria-label="Search users"
        />
        <div className="max-h-48 overflow-y-auto">
          {loading ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Loading users...
            </p>
          ) : (
            <>
              {/* Clear option */}
              {selectedId && (
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
                >
                  <X className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Clear owner</span>
                </button>
              )}

              {filtered.map((user) => {
                const isSelected = user.id === selectedId;
                const label = user.display_name || user.email;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelect(user)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  >
                    <Check
                      className={cn(
                        'size-3.5 shrink-0',
                        isSelected ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{label}</span>
                    {user.display_name && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    )}
                  </button>
                );
              })}

              {filtered.length === 0 && !loading && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No matching users found.
                </p>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
