import {
  MessageSquare,
  FileText,
  BookOpen,
  File,
  Package,
  Headphones,
  Play,
  Mail,
  Bookmark,
  ScrollText,
  StickyNote,
  GraduationCap,
  FlaskConical,
  MessageCircle,
  HelpCircle,
  CircleHelp,
  FileCheck,
  Shield,
  Award,
  ClipboardCheck,
  Workflow,
  Star,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  post: MessageSquare,
  article: FileText,
  blog: BookOpen,
  pdf: File,
  'product-page': Package,
  podcast: Headphones,
  video: Play,
  newsletter: Mail,
  bookmark: Bookmark,
  transcript: ScrollText,
  note: StickyNote,
  course: GraduationCap,
  research: FlaskConical,
  comment: MessageCircle,
  other: HelpCircle,
  // Knowledge Hub content types
  q_a_pair: CircleHelp,
  case_study: FileCheck,
  policy: Shield,
  certification: Award,
  compliance: ClipboardCheck,
  methodology: Workflow,
  capability: Star,
  product_description: ShoppingBag,
};

interface ContentTypeIconProps {
  contentType: string | null;
  className?: string;
  /** Icon size in Tailwind class form, e.g. "size-3" or "size-3.5". Defaults to "size-3.5" */
  size?: string;
}

/**
 * Renders a small Lucide icon matching the given content type.
 * Falls back to HelpCircle for unknown types.
 */
export function ContentTypeIcon({
  contentType,
  className,
  size = 'size-3.5',
}: ContentTypeIconProps) {
  if (!contentType) return null;

  const Icon = ICON_MAP[contentType] ?? HelpCircle;

  return (
    <Icon
      className={cn(size, 'shrink-0 text-muted-foreground', className)}
      aria-hidden="true"
    />
  );
}

/** Get the Lucide icon component for a content type (useful outside JSX) */
export function getContentTypeIcon(contentType: string): LucideIcon {
  return ICON_MAP[contentType] ?? HelpCircle;
}
