'use client';

import { useState } from 'react';
import {
  Shield,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { ExpiryBadge } from '@/components/dashboard/expiry-badge';
import { generateCertificationReviewPrompt } from '@/lib/claude-prompts';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';
import type { ExpiryStatus } from '@/lib/certification-status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItemRef {
  id: string;
  title: string;
}

interface CertificationMetadata {
  version?: string;
  issuing_body?: string;
  date_obtained?: string;
  expiry_date?: string;
  scope?: string;
  certificate_number?: string;
  holder?: 'self' | 'supplier';
  supplier_name?: string;
  notes?: string;
}

interface RegistrationMetadata {
  registration_number?: string;
  date_registered?: string;
  expiry_date?: string;
  registering_body?: string;
  notes?: string;
}

export interface CertificationEntry {
  canonical_name: string;
  entity_type: 'certification';
  mention_count: number;
  content_item_count: number;
  content_items: ContentItemRef[];
  holder: 'self' | 'supplier';
  supplier_name?: string;
  metadata: CertificationMetadata;
  expiry_status: ExpiryStatus;
}

export interface RegistrationEntry {
  canonical_name: string;
  entity_type: 'regulation';
  mention_count: number;
  content_item_count: number;
  content_items: ContentItemRef[];
  metadata: RegistrationMetadata;
  expiry_status: ExpiryStatus;
}

interface CertificationSummaryCardProps {
  certifications: CertificationEntry[];
  supplierCertifications: CertificationEntry[];
  registrations: RegistrationEntry[];
  onEditEntity?: (canonicalName: string) => void;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatDate(isoDate?: string): string {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

// ---------------------------------------------------------------------------
// Copy text generation
// ---------------------------------------------------------------------------

function generateCopyText(
  certifications: CertificationEntry[],
  registrations: RegistrationEntry[],
): string {
  const parts: string[] = [];

  if (certifications.length > 0) {
    const certDescriptions = certifications.map((cert) => {
      const nameParts = [formatEntityDisplayName(cert.canonical_name)];
      if (cert.metadata.version) nameParts[0] += `:${cert.metadata.version}`;

      const details: string[] = [];
      if (cert.metadata.issuing_body) {
        details.push(`certified by ${cert.metadata.issuing_body}`);
      }
      if (cert.metadata.scope) {
        details.push(`scope: ${cert.metadata.scope}`);
      }
      if (cert.metadata.date_obtained && cert.metadata.expiry_date) {
        details.push(
          `renewed ${formatDate(cert.metadata.date_obtained)}, expires ${formatDate(cert.metadata.expiry_date)}`,
        );
      } else if (cert.metadata.expiry_date) {
        details.push(`expires ${formatDate(cert.metadata.expiry_date)}`);
      }

      if (details.length > 0) {
        return `${nameParts[0]} (${details.join(', ')})`;
      }
      return nameParts[0];
    });

    if (certDescriptions.length === 1) {
      parts.push(`We hold ${certDescriptions[0]}.`);
    } else {
      const last = certDescriptions.pop();
      parts.push(`We hold ${certDescriptions.join(', ')}, and ${last}.`);
    }
  }

  if (registrations.length > 0) {
    const regDescriptions = registrations.map((reg) => {
      const details: string[] = [];
      if (reg.metadata.registration_number) {
        details.push(`registration number ${reg.metadata.registration_number}`);
      }
      if (details.length > 0) {
        return `${formatEntityDisplayName(reg.canonical_name)} (${details.join(', ')})`;
      }
      return formatEntityDisplayName(reg.canonical_name);
    });

    parts.push(`We are registered with ${regDescriptions.join(', ')}.`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Certification row
// ---------------------------------------------------------------------------

function CertificationRow({
  cert,
  onEdit,
}: {
  cert: CertificationEntry;
  onEdit?: (name: string) => void;
}) {
  const needsRenewal =
    cert.expiry_status === 'expiring_soon' || cert.expiry_status === 'expired';
  // Navigate to the first content item for renewal context
  const renewalItemId = cert.content_items?.[0]?.id;
  // ID-135.26: content_items[].id is a source_documents id
  // (app/api/certifications/route.ts re-points evidence-link ids onto
  // source_documents post-{131.19} — content_items is dead grain).
  const itemLink = cert.content_items?.[0]?.id
    ? `/documents/${cert.content_items[0].id}`
    : null;

  const cardContent = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onEdit(cert.canonical_name);
              }}
              className="cursor-pointer text-sm font-medium text-foreground hover:underline"
              aria-label={`Edit ${formatEntityDisplayName(cert.canonical_name)}`}
            >
              {formatEntityDisplayName(cert.canonical_name)}
              {cert.metadata.version && (
                <span className="ml-1 text-xs text-muted-foreground">
                  v{cert.metadata.version}
                </span>
              )}
            </button>
          ) : (
            <span className="text-sm font-medium text-foreground">
              {formatEntityDisplayName(cert.canonical_name)}
              {cert.metadata.version && (
                <span className="ml-1 text-xs text-muted-foreground">
                  v{cert.metadata.version}
                </span>
              )}
            </span>
          )}
          <ExpiryBadge status={cert.expiry_status} />
          {needsRenewal && renewalItemId && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              asChild
            >
              <Link
                href={`/documents/${renewalItemId}`}
                aria-label={`Review ${cert.canonical_name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Review
              </Link>
            </Button>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {cert.metadata.issuing_body && (
            <p>Issuing body: {cert.metadata.issuing_body}</p>
          )}
          {cert.metadata.date_obtained && (
            <p>Obtained: {formatDate(cert.metadata.date_obtained)}</p>
          )}
          {cert.metadata.expiry_date && (
            <p>Expires: {formatDate(cert.metadata.expiry_date)}</p>
          )}
          {cert.metadata.scope && <p>Scope: {cert.metadata.scope}</p>}
        </div>
      </div>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        aria-label={`${cert.content_item_count} linked ${cert.content_item_count === 1 ? 'item' : 'items'}`}
      >
        {cert.content_item_count} linked{' '}
        {cert.content_item_count === 1 ? 'item' : 'items'}
      </span>
    </>
  );

  if (itemLink) {
    return (
      <Link
        href={itemLink}
        className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-accent/50"
        role="listitem"
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3"
      role="listitem"
    >
      {cardContent}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration row
// ---------------------------------------------------------------------------

function RegistrationRow({
  reg,
  onEdit,
}: {
  reg: RegistrationEntry;
  onEdit?: (name: string) => void;
}) {
  const needsRenewal =
    reg.expiry_status === 'expiring_soon' || reg.expiry_status === 'expired';
  const renewalItemId = reg.content_items?.[0]?.id;
  // ID-135.26: content_items[].id is a source_documents id
  // (app/api/certifications/route.ts re-points evidence-link ids onto
  // source_documents post-{131.19} — content_items is dead grain).
  const itemLink = reg.content_items?.[0]?.id
    ? `/documents/${reg.content_items[0].id}`
    : null;

  const cardContent = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onEdit(reg.canonical_name);
              }}
              className="cursor-pointer text-sm font-medium text-foreground hover:underline"
              aria-label={`Edit ${formatEntityDisplayName(reg.canonical_name)}`}
            >
              {formatEntityDisplayName(reg.canonical_name)}
            </button>
          ) : (
            <span className="text-sm font-medium text-foreground">
              {formatEntityDisplayName(reg.canonical_name)}
            </span>
          )}
          <ExpiryBadge status={reg.expiry_status} />
          {needsRenewal && renewalItemId && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              asChild
            >
              <Link
                href={`/documents/${renewalItemId}`}
                aria-label={`Review ${reg.canonical_name}`}
                onClick={(e) => e.stopPropagation()}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Review
              </Link>
            </Button>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {reg.metadata.registering_body && (
            <p>Registering body: {reg.metadata.registering_body}</p>
          )}
          {reg.metadata.registration_number && (
            <p>Registration: {reg.metadata.registration_number}</p>
          )}
          {reg.metadata.date_registered && (
            <p>Registered: {formatDate(reg.metadata.date_registered)}</p>
          )}
          {reg.metadata.expiry_date && (
            <p>Expires: {formatDate(reg.metadata.expiry_date)}</p>
          )}
        </div>
      </div>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        aria-label={`${reg.content_item_count} linked ${reg.content_item_count === 1 ? 'item' : 'items'}`}
      >
        {reg.content_item_count} linked{' '}
        {reg.content_item_count === 1 ? 'item' : 'items'}
      </span>
    </>
  );

  if (itemLink) {
    return (
      <Link
        href={itemLink}
        className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-accent/50"
        role="listitem"
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3"
      role="listitem"
    >
      {cardContent}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplier section
// ---------------------------------------------------------------------------

function SupplierSection({
  supplierCerts,
  onEdit,
}: {
  supplierCerts: CertificationEntry[];
  onEdit?: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (supplierCerts.length === 0) return null;

  // Group by supplier name
  const bySupplier = new Map<string, CertificationEntry[]>();
  for (const cert of supplierCerts) {
    const name = cert.supplier_name ?? 'Unknown supplier';
    const existing = bySupplier.get(name) ?? [];
    existing.push(cert);
    bySupplier.set(name, existing);
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        aria-controls="supplier-certifications"
      >
        {expanded ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
        Supplier Certifications ({supplierCerts.length})
      </button>

      {expanded && (
        <div id="supplier-certifications" className="mt-2 space-y-3">
          {Array.from(bySupplier.entries()).map(([supplierName, certs]) => (
            <div key={supplierName}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {supplierName}
              </p>
              <div
                className="space-y-1.5"
                role="list"
                aria-label={`${supplierName} certifications`}
              >
                {certs.map((cert) => (
                  <CertificationRow
                    key={cert.canonical_name}
                    cert={cert}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CertificationSummaryCard({
  certifications,
  supplierCertifications,
  registrations,
  onEditEntity,
}: CertificationSummaryCardProps) {
  const [copied, setCopied] = useState(false);

  if (
    certifications.length === 0 &&
    supplierCertifications.length === 0 &&
    registrations.length === 0
  ) {
    return null;
  }

  const expiringCount = certifications.filter(
    (c) => c.expiry_status === 'expiring_soon',
  ).length;

  async function handleCopy() {
    try {
      const text = generateCopyText(certifications, registrations);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Certification summary copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  return (
    <section
      aria-label="Certifications we hold"
      className="rounded-lg border bg-card p-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Shield className="size-4" aria-hidden="true" />
          Certifications We Hold
        </h3>
        <div className="flex items-center gap-1">
          <ClaudePromptButton
            prompt={
              generateCertificationReviewPrompt(
                certifications.length,
                expiringCount,
              ).prompt
            }
            label="Review with Claude"
            size="sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Copy certification summary to clipboard"
          >
            {copied ? (
              <Check
                className="size-3.5 text-freshness-fresh"
                aria-hidden="true"
              />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {/* Self-held certifications */}
      {certifications.length > 0 && (
        <div
          className="mt-3 space-y-1.5"
          role="list"
          aria-label="Self-held certifications"
        >
          {certifications.map((cert) => (
            <CertificationRow
              key={cert.canonical_name}
              cert={cert}
              onEdit={onEditEntity}
            />
          ))}
        </div>
      )}

      {/* Registrations */}
      {registrations.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Registrations
          </h4>
          <div className="space-y-1.5" role="list" aria-label="Registrations">
            {registrations.map((reg) => (
              <RegistrationRow
                key={reg.canonical_name}
                reg={reg}
                onEdit={onEditEntity}
              />
            ))}
          </div>
        </div>
      )}

      {/* Supplier certifications (collapsible) */}
      <SupplierSection
        supplierCerts={supplierCertifications}
        onEdit={onEditEntity}
      />
    </section>
  );
}
