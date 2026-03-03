'use client';

import { BookCheck, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useReadMarks } from '@/contexts/read-marks-context';
import { cn } from '@/lib/utils';

interface ReadToggleButtonProps {
  itemId: string;
  className?: string;
}

export function ReadToggleButton({ itemId, className }: ReadToggleButtonProps) {
  const { isRead, toggleRead } = useReadMarks();
  const read = isRead(itemId);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await toggleRead(itemId, 'manual');
    toast(read ? 'Marked as unread' : 'Marked as read', {
      duration: 2000,
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      className={cn('gap-1.5', className)}
      aria-label={read ? 'Mark as unread' : 'Mark as read'}
      style={{ minHeight: '44px', minWidth: '44px' }}
    >
      {read ? (
        <BookCheck className="size-3.5" />
      ) : (
        <BookOpen className="size-3.5" />
      )}
      {read ? 'Read' : 'Mark as read'}
    </Button>
  );
}
