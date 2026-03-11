'use client';

import { Loader2, Plus, Tags } from 'lucide-react';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTaxonomyAdmin } from '@/hooks/use-taxonomy-admin';
import { DomainCard } from '@/components/settings/domain-card';
import { TaxonomyDialogs } from '@/components/settings/taxonomy-dialogs';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TaxonomySection() {
  const { refresh } = useTaxonomy();
  const t = useTaxonomyAdmin({ refresh });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (t.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Taxonomy Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Manage knowledge base domains and subtopics. Deactivated items are
            hidden from filters but existing content retains its classification.
          </p>
        </div>
        <Button size="sm" onClick={t.openAddDomain}>
          <Plus className="mr-1.5 size-4" />
          Add Domain
        </Button>
      </div>

      {t.domains.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Tags className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No domains configured yet</p>
            <p className="text-xs text-muted-foreground">
              Add domains and subtopics to organise your knowledge base.
            </p>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {t.domains.map((domain, idx) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              index={idx}
              domainCount={t.domains.length}
              isExpanded={t.expandedDomains.has(domain.id)}
              subtopics={t.subtopicsByDomain.get(domain.id) ?? []}
              onToggle={t.toggleDomain}
              onEdit={t.openEditDomain}
              onDeactivate={t.confirmDeactivate}
              onReactivate={t.handleReactivate}
              onAcceptRecommended={t.handleAcceptRecommended}
              onRejectRecommended={t.handleRejectRecommended}
              onMoveDomain={t.handleMoveDomain}
              onMoveSubtopic={t.handleMoveSubtopic}
              onAddSubtopic={t.openAddSubtopic}
              onEditSubtopic={t.openEditSubtopic}
            />
          ))}
        </div>
      )}

      <TaxonomyDialogs
        domainDialogOpen={t.domainDialogOpen}
        setDomainDialogOpen={t.setDomainDialogOpen}
        editingDomain={t.editingDomain}
        domainName={t.domainName}
        setDomainName={t.setDomainName}
        domainColour={t.domainColour}
        setDomainColour={t.setDomainColour}
        domainOrder={t.domainOrder}
        setDomainOrder={t.setDomainOrder}
        domainSaving={t.domainSaving}
        handleDomainSubmit={t.handleDomainSubmit}
        subtopicDialogOpen={t.subtopicDialogOpen}
        setSubtopicDialogOpen={t.setSubtopicDialogOpen}
        editingSubtopic={t.editingSubtopic}
        subtopicName={t.subtopicName}
        setSubtopicName={t.setSubtopicName}
        subtopicOrder={t.subtopicOrder}
        setSubtopicOrder={t.setSubtopicOrder}
        subtopicSaving={t.subtopicSaving}
        handleSubtopicSubmit={t.handleSubtopicSubmit}
        deactivateDialogOpen={t.deactivateDialogOpen}
        setDeactivateDialogOpen={t.setDeactivateDialogOpen}
        deactivateTarget={t.deactivateTarget}
        handleDeactivate={t.handleDeactivate}
      />

      {/* Screen reader announcements */}
      <div aria-live="polite" className="sr-only">
        {t.announcement}
      </div>
    </div>
  );
}
