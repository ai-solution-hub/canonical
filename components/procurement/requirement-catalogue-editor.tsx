'use client';

/**
 * Custom requirement-catalogue editor (ID-147 {147.16}, TECH §7/§H1,
 * PRODUCT §H1/§H3/§H4; ID-145 BI-24/BI-47).
 *
 * A CUSTOM editor over the reusable requirement catalogue
 * (`form_requirement_templates`) exposing every one of its domain fields —
 * `requirement_type`, `requirement_text`, `matching_keywords`,
 * `matching_guidance`, `is_mandatory`, `word_limit_guidance`, `section_ref`,
 * `sector_applicability`, domain/subtopic classification (`primary_domain`/
 * `primary_subtopic`/`secondary_domain`/`secondary_subtopic`), plus the
 * structural identification columns needed to persist a valid row
 * (`template_name`, `template_version`, `template_type`, `section_name`,
 * `question_number`, `description`, `is_current`, `display_order`).
 *
 * Extend Schema Builder is deliberately NOT used here (DR-065 — it carries no
 * domain metadata) and is not presented anywhere in this surface (§H4);
 * Schema Builder remains reserved for a future JSON-extraction feature only.
 *
 * Create/edit is admin/editor-gated (§H3, BI-47): the catalogue's own RLS
 * policies (`template_requirements_insert`/`_update`, admin+editor;
 * `template_requirements_delete`, admin-only) already enforce this at the
 * database layer regardless of what the UI does. This component additionally
 * hides the add/edit affordances from non-editors via `useUserRole()` so
 * reviewer/viewer roles see a read-only list — belt + braces, not the sole
 * gate. This is a self-contained global admin surface: the catalogue is
 * reusable across forms, not scoped to any one item.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/use-user-role';
import {
  REQUIREMENT_TYPES,
  useRequirementTemplates,
  useSaveRequirementTemplate,
  type RequirementTemplateRow,
  type RequirementType,
} from '@/lib/query/requirement-catalogue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Splits a comma-separated free-text field into a trimmed array, or `null`
 * when nothing was entered — matches the column's nullable `text[]` shape. */
function parseCommaList(raw: string): string[] | null {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function joinList(list: string[] | null | undefined): string {
  return (list ?? []).join(', ');
}

/** Blank starting values for the "add" form. */
const BLANK_FORM_VALUES = {
  templateName: '',
  templateVersion: '',
  templateType: '',
  sectionRef: '',
  sectionName: '',
  questionNumber: '',
  requirementText: '',
  description: '',
  requirementType: REQUIREMENT_TYPES[0] as RequirementType,
  primaryDomain: '',
  primarySubtopic: '',
  secondaryDomain: '',
  secondarySubtopic: '',
  matchingKeywords: '',
  matchingGuidance: '',
  isMandatory: true,
  isCurrent: true,
  sectorApplicability: '',
  wordLimitGuidance: '',
  displayOrder: '0',
};

type FormValues = typeof BLANK_FORM_VALUES;

function valuesFromRow(row: RequirementTemplateRow): FormValues {
  return {
    templateName: row.template_name,
    templateVersion: row.template_version ?? '',
    templateType: row.template_type,
    sectionRef: row.section_ref,
    sectionName: row.section_name,
    questionNumber:
      row.question_number === null || row.question_number === undefined
        ? ''
        : String(row.question_number),
    requirementText: row.requirement_text,
    description: row.description ?? '',
    requirementType: row.requirement_type as RequirementType,
    primaryDomain: row.primary_domain ?? '',
    primarySubtopic: row.primary_subtopic ?? '',
    secondaryDomain: row.secondary_domain ?? '',
    secondarySubtopic: row.secondary_subtopic ?? '',
    matchingKeywords: joinList(row.matching_keywords),
    matchingGuidance: row.matching_guidance ?? '',
    isMandatory: row.is_mandatory ?? true,
    isCurrent: row.is_current ?? true,
    sectorApplicability: joinList(row.sector_applicability),
    wordLimitGuidance:
      row.word_limit_guidance === null || row.word_limit_guidance === undefined
        ? ''
        : String(row.word_limit_guidance),
    displayOrder: String(row.display_order ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Form panel (create + edit — same shape, keyed off `editingId`)
// ---------------------------------------------------------------------------

interface RequirementTemplateFormPanelProps {
  editing: RequirementTemplateRow | null;
  onClose: () => void;
}

function RequirementTemplateFormPanel({
  editing,
  onClose,
}: RequirementTemplateFormPanelProps) {
  const [values, setValues] = useState<FormValues>(() =>
    editing ? valuesFromRow(editing) : BLANK_FORM_VALUES,
  );
  const saveMutation = useSaveRequirementTemplate();

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const isValid =
    values.templateName.trim() !== '' &&
    values.templateType.trim() !== '' &&
    values.sectionRef.trim() !== '' &&
    values.sectionName.trim() !== '' &&
    values.requirementText.trim() !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    const questionNumber =
      values.questionNumber.trim() === ''
        ? null
        : Number(values.questionNumber);
    const wordLimitGuidance =
      values.wordLimitGuidance.trim() === ''
        ? null
        : Number(values.wordLimitGuidance);
    const displayOrder =
      values.displayOrder.trim() === '' ? 0 : Number(values.displayOrder);

    try {
      await saveMutation.mutateAsync({
        id: editing?.id,
        values: {
          template_name: values.templateName.trim(),
          template_version: values.templateVersion.trim() || null,
          template_type: values.templateType.trim(),
          section_ref: values.sectionRef.trim(),
          section_name: values.sectionName.trim(),
          question_number: questionNumber,
          requirement_text: values.requirementText.trim(),
          description: values.description.trim() || null,
          requirement_type: values.requirementType,
          primary_domain: values.primaryDomain.trim() || null,
          primary_subtopic: values.primarySubtopic.trim() || null,
          secondary_domain: values.secondaryDomain.trim() || null,
          secondary_subtopic: values.secondarySubtopic.trim() || null,
          matching_keywords: parseCommaList(values.matchingKeywords),
          matching_guidance: values.matchingGuidance.trim() || null,
          is_mandatory: values.isMandatory,
          is_current: values.isCurrent,
          sector_applicability: parseCommaList(values.sectorApplicability),
          word_limit_guidance: wordLimitGuidance,
          display_order: displayOrder,
        },
      });
      toast.success(editing ? 'Requirement updated' : 'Requirement added');
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save requirement',
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-4 shadow-sm"
      aria-label={editing ? 'Edit requirement' : 'Add requirement'}
    >
      <h3 className="mb-4 text-base font-semibold text-foreground">
        {editing ? 'Edit Requirement' : 'Add Requirement'}
      </h3>

      <div className="space-y-6">
        {/* Identification */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-foreground">
            Identification
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rc-template-name">Template name *</Label>
              <Input
                id="rc-template-name"
                value={values.templateName}
                onChange={(e) => set('templateName', e.target.value)}
                placeholder="e.g. Standard PSQ"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-template-version">Template version</Label>
              <Input
                id="rc-template-version"
                value={values.templateVersion}
                onChange={(e) => set('templateVersion', e.target.value)}
                placeholder="e.g. v1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-template-type">Template type *</Label>
              <Input
                id="rc-template-type"
                value={values.templateType}
                onChange={(e) => set('templateType', e.target.value)}
                placeholder="e.g. PSQ"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-question-number">Question number</Label>
              <Input
                id="rc-question-number"
                type="number"
                value={values.questionNumber}
                onChange={(e) => set('questionNumber', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-section-ref">Section ref *</Label>
              <Input
                id="rc-section-ref"
                value={values.sectionRef}
                onChange={(e) => set('sectionRef', e.target.value)}
                placeholder="e.g. 3.2"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-section-name">Section name *</Label>
              <Input
                id="rc-section-name"
                value={values.sectionName}
                onChange={(e) => set('sectionName', e.target.value)}
                placeholder="e.g. Health and Safety"
                required
              />
            </div>
          </div>
        </fieldset>

        {/* Requirement */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-foreground">
            Requirement
          </legend>
          <div className="space-y-2">
            <Label htmlFor="rc-requirement-text">Requirement text *</Label>
            <Textarea
              id="rc-requirement-text"
              value={values.requirementText}
              onChange={(e) => set('requirementText', e.target.value)}
              placeholder="The full requirement wording as it appears in the source form"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rc-description">Description</Label>
            <Textarea
              id="rc-description"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional additional context"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rc-requirement-type">Requirement type *</Label>
            <Select
              value={values.requirementType}
              onValueChange={(v) =>
                set('requirementType', v as RequirementType)
              }
            >
              <SelectTrigger id="rc-requirement-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUIREMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </fieldset>

        {/* Domain/subtopic classification */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-foreground">
            Classification
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rc-primary-domain">Primary domain</Label>
              <Input
                id="rc-primary-domain"
                value={values.primaryDomain}
                onChange={(e) => set('primaryDomain', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-primary-subtopic">Primary subtopic</Label>
              <Input
                id="rc-primary-subtopic"
                value={values.primarySubtopic}
                onChange={(e) => set('primarySubtopic', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-secondary-domain">Secondary domain</Label>
              <Input
                id="rc-secondary-domain"
                value={values.secondaryDomain}
                onChange={(e) => set('secondaryDomain', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-secondary-subtopic">Secondary subtopic</Label>
              <Input
                id="rc-secondary-subtopic"
                value={values.secondarySubtopic}
                onChange={(e) => set('secondarySubtopic', e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {/* Matching */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-foreground">
            Matching
          </legend>
          <div className="space-y-2">
            <Label htmlFor="rc-matching-keywords">
              Matching keywords (comma-separated)
            </Label>
            <Input
              id="rc-matching-keywords"
              value={values.matchingKeywords}
              onChange={(e) => set('matchingKeywords', e.target.value)}
              placeholder="e.g. safety, RIDDOR, accreditation"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rc-matching-guidance">Matching guidance</Label>
            <Textarea
              id="rc-matching-guidance"
              value={values.matchingGuidance}
              onChange={(e) => set('matchingGuidance', e.target.value)}
              placeholder="Guidance for matching corpus content to this requirement"
            />
          </div>
        </fieldset>

        {/* Constraints */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-foreground">
            Constraints
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rc-word-limit">Word limit guidance</Label>
              <Input
                id="rc-word-limit"
                type="number"
                min={0}
                value={values.wordLimitGuidance}
                onChange={(e) => set('wordLimitGuidance', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-display-order">Display order</Label>
              <Input
                id="rc-display-order"
                type="number"
                value={values.displayOrder}
                onChange={(e) => set('displayOrder', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rc-sector-applicability">
              Sector applicability (comma-separated)
            </Label>
            <Input
              id="rc-sector-applicability"
              value={values.sectorApplicability}
              onChange={(e) => set('sectorApplicability', e.target.value)}
              placeholder="e.g. construction, facilities-management"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="rc-is-mandatory"
              checked={values.isMandatory}
              onCheckedChange={(v) => set('isMandatory', v)}
            />
            <Label htmlFor="rc-is-mandatory" className="cursor-pointer">
              Mandatory
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="rc-is-current"
              checked={values.isCurrent}
              onCheckedChange={(v) => set('isCurrent', v)}
            />
            <Label htmlFor="rc-is-current" className="cursor-pointer">
              Current (visible for matching)
            </Label>
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saveMutation.isPending || !isValid}
        >
          {saveMutation.isPending
            ? 'Saving...'
            : editing
              ? 'Update Requirement'
              : 'Save Requirement'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------

interface RequirementRowProps {
  row: RequirementTemplateRow;
  canEdit: boolean;
  onEdit: (row: RequirementTemplateRow) => void;
}

function RequirementRow({ row, canEdit, onEdit }: RequirementRowProps) {
  const domainLabel = [row.primary_domain, row.primary_subtopic]
    .filter(Boolean)
    .join(' / ');

  return (
    <tr className="border-b transition-colors last:border-0">
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-foreground">{row.template_name}</div>
        <div className="text-xs text-muted-foreground">
          {row.section_ref} &middot; {row.section_name}
        </div>
      </td>
      <td className="px-3 py-2 align-top text-foreground">
        {row.requirement_text}
      </td>
      <td className="px-3 py-2 align-top">
        <Badge variant="outline">{row.requirement_type}</Badge>
      </td>
      <td className="px-3 py-2 align-top text-muted-foreground">
        {domainLabel || '—'}
      </td>
      <td className="px-3 py-2 align-top">
        <span className="text-sm font-medium text-foreground">
          {row.is_mandatory ? 'Mandatory' : 'Optional'}
        </span>
        {row.is_current === false && (
          <span className="ml-2 text-xs text-muted-foreground">(retired)</span>
        )}
      </td>
      <td className="px-3 py-2 align-top text-right">
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.template_name} — ${row.section_ref}`}
          >
            <Pencil className="mr-1 size-3.5" />
            Edit
          </Button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RequirementCatalogueEditor({
  className,
}: {
  className?: string;
}) {
  const { canEdit } = useUserRole();
  const { data: rows, isLoading, isError, error } = useRequirementTemplates();
  const [panelState, setPanelState] = useState<
    { mode: 'add' } | { mode: 'edit'; row: RequirementTemplateRow } | null
  >(null);

  const sortedRows = useMemo(() => rows ?? [], [rows]);

  function closePanel() {
    setPanelState(null);
  }

  // A failed fetch must not be masked as "no requirements yet" (silent
  // failure) — surface it distinctly, inline and via toast, matching the
  // save-path toast.error pattern above.
  useEffect(() => {
    if (isError) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to load the requirement catalogue',
      );
    }
  }, [isError, error]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12 text-center',
          className,
        )}
      >
        <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
        <p className="text-sm font-medium text-destructive">
          Failed to load the requirement catalogue
        </p>
        <p className="text-xs text-muted-foreground">
          {error instanceof Error ? error.message : 'Please try again.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Requirement Catalogue
          </h3>
          <p className="text-sm text-muted-foreground">
            The reusable requirements every form draws its matching from.
          </p>
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setPanelState({ mode: 'add' })}
            disabled={panelState !== null}
          >
            <Plus className="mr-1.5 size-4" />
            Add Requirement
          </Button>
        )}
      </div>

      {panelState && (
        <RequirementTemplateFormPanel
          editing={panelState.mode === 'edit' ? panelState.row : null}
          onClose={closePanel}
        />
      )}

      {sortedRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12 text-center">
          <ClipboardList
            className="size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            No catalogue requirements yet
          </p>
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? 'Add the first requirement to start matching corpus content against it.'
              : 'An admin or editor has not added any catalogue requirements yet.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Template / Section</th>
                <th className="px-3 py-2 font-medium">Requirement</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Domain / Subtopic</th>
                <th className="px-3 py-2 font-medium">Mandatory</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <RequirementRow
                  key={row.id}
                  row={row}
                  canEdit={canEdit}
                  onEdit={(r) => setPanelState({ mode: 'edit', row: r })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
