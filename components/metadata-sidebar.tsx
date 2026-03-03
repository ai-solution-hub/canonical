'use client';

import { Check, Pencil } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DomainBadge } from '@/components/domain-badge';
import { SourceMetadata } from '@/components/source-metadata';
import {
  formatDateUK,
  formatContentType,
  formatPlatform,
} from '@/lib/format';
import {
  DOMAINS,
  getDomainNames,
  getSubtopics,
  formatSubtopic,
} from '@/lib/taxonomy';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

interface MetadataSidebarProps {
  item: ItemData;
  editingField: string | null;
  editValue: string;
  saveSuccess: string | null;
  startEdit: (field: string) => void;
  saveEdit: (field: string, value: unknown) => void;
}

export function MetadataSidebar({
  item,
  editingField,
  editValue,
  saveSuccess,
  startEdit,
  saveEdit,
}: MetadataSidebarProps) {
  return (
    <aside className="w-full max-w-md shrink-0 lg:max-w-none lg:w-72">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Metadata
        </h2>
        <dl className="flex flex-col gap-3 text-sm">
          {/* Domain (editable) */}
          <div className="group flex items-start justify-between">
            <div>
              <dt className="text-xs text-muted-foreground">Domain</dt>
              {editingField === 'primary_domain' ? (
                <Select
                  value={editValue}
                  onValueChange={(val) => {
                    saveEdit('primary_domain', val);
                    // Clear subtopic when domain changes
                    saveEdit(
                      'primary_subtopic',
                      getSubtopics(val as keyof typeof DOMAINS)?.[0] ?? '',
                    );
                  }}
                >
                  <SelectTrigger className="mt-1 h-8 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getDomainNames().map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <dd className="flex items-center gap-1.5">
                  <DomainBadge
                    domain={(item.primary_domain as string) ?? ''}
                  />
                  {saveSuccess === 'primary_domain' ? (
                    <Check className="size-3 text-[var(--success)]" />
                  ) : (
                    <button
                      onClick={() => startEdit('primary_domain')}
                      className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      aria-label="Edit domain"
                    >
                      <Pencil className="size-3 text-muted-foreground" />
                    </button>
                  )}
                </dd>
              )}
            </div>
          </div>

          {/* Subtopic (editable) */}
          <div className="group">
            <dt className="text-xs text-muted-foreground">Subtopic</dt>
            {editingField === 'primary_subtopic' ? (
              <Select
                value={editValue}
                onValueChange={(val) => saveEdit('primary_subtopic', val)}
              >
                <SelectTrigger className="mt-1 h-8 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getSubtopics(
                    item.primary_domain as keyof typeof DOMAINS,
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {formatSubtopic(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <dd className="flex items-center gap-1.5 text-foreground">
                {formatSubtopic((item.primary_subtopic as string) ?? '')}
                {saveSuccess === 'primary_subtopic' ? (
                  <Check className="size-3 text-[var(--success)]" />
                ) : (
                  <button
                    onClick={() => startEdit('primary_subtopic')}
                    className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    aria-label="Edit subtopic"
                  >
                    <Pencil className="size-3 text-muted-foreground" />
                  </button>
                )}
              </dd>
            )}
          </div>

          <div>
            <dt className="text-xs text-muted-foreground">Type</dt>
            <dd className="text-foreground">
              {formatContentType(item.content_type as string)}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-muted-foreground">Platform</dt>
            <dd className="text-foreground">
              {formatPlatform(item.platform as string)}
            </dd>
          </div>

          {item.author_name && (
            <div>
              <dt className="text-xs text-muted-foreground">Author</dt>
              <dd className="text-foreground">{item.author_name}</dd>
            </div>
          )}

          {item.source_domain && (
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="text-foreground">{item.source_domain}</dd>
            </div>
          )}

          <div>
            <dt className="text-xs text-muted-foreground">Captured</dt>
            <dd className="text-foreground">
              {formatDateUK(item.captured_date as string)}
            </dd>
          </div>

          {item.classification_confidence != null && (
            <div>
              <dt className="text-xs text-muted-foreground">Confidence</dt>
              <dd className="text-foreground">
                {((item.classification_confidence as number) * 100).toFixed(
                  0,
                )}
                %
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Classification details accordion */}
      <Accordion type="single" collapsible className="mt-4">
        <AccordionItem
          value="classification"
          className="rounded-lg border border-border"
        >
          <AccordionTrigger className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
            Classification Details
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <dl className="flex flex-col gap-3 text-sm">
              {item.classification_reasoning && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Reasoning
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-foreground">
                    {item.classification_reasoning}
                  </dd>
                </div>
              )}
              {(item.secondary_domain || item.secondary_subtopic) && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Secondary
                  </dt>
                  <dd className="text-foreground">
                    {item.secondary_domain}
                    {item.secondary_subtopic && (
                      <>
                        {' '}
                        /{' '}
                        {formatSubtopic(item.secondary_subtopic as string)}
                      </>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <SourceMetadata
        contentType={item.content_type as string}
        platform={item.platform as string}
        metadata={item.metadata}
        content={item.content as string | null}
      />
    </aside>
  );
}
