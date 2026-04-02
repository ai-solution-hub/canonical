'use client';

import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Layers,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { useLayerAdmin, type AdminLayer } from '@/hooks/use-layer-admin';

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

function generateKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

// ---------------------------------------------------------------------------
// Layer form dialog
// ---------------------------------------------------------------------------

function LayerFormDialog({
  open,
  onOpenChange,
  editingLayer,
  layerKey,
  setLayerKey,
  layerLabel,
  setLayerLabel,
  layerDescription,
  setLayerDescription,
  layerOrder,
  setLayerOrder,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLayer: AdminLayer | null;
  layerKey: string;
  setLayerKey: (v: string) => void;
  layerLabel: string;
  setLayerLabel: (v: string) => void;
  layerDescription: string;
  setLayerDescription: (v: string) => void;
  layerOrder: string;
  setLayerOrder: (v: string) => void;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}) {
  const isEditing = !!editingLayer;

  const handleLabelChange = (value: string) => {
    setLayerLabel(value);
    // Auto-generate key from label (only for new layers)
    if (!isEditing) {
      setLayerKey(generateKey(value));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Layer' : 'Add Layer'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the layer details. The key cannot be changed.'
                : 'Define a new content layer for your knowledge base.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label
                htmlFor="layer-label"
                className="text-xs font-medium text-muted-foreground"
              >
                Label
              </label>
              <Input
                id="layer-label"
                value={layerLabel}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="e.g. Technical Detail"
                className="mt-1"
                required
              />
            </div>

            <div>
              <label
                htmlFor="layer-key"
                className="text-xs font-medium text-muted-foreground"
              >
                Key
              </label>
              <Input
                id="layer-key"
                value={layerKey}
                onChange={(e) => setLayerKey(e.target.value)}
                placeholder="e.g. technical_detail"
                className="mt-1 font-mono text-sm"
                disabled={isEditing}
                required
              />
              {isEditing && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Key cannot be changed after creation
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="layer-description"
                className="text-xs font-medium text-muted-foreground"
              >
                Description
              </label>
              <Input
                id="layer-description"
                value={layerDescription}
                onChange={(e) => setLayerDescription(e.target.value)}
                placeholder="Optional description"
                className="mt-1"
              />
            </div>

            <div>
              <label
                htmlFor="layer-order"
                className="text-xs font-medium text-muted-foreground"
              >
                Display Order
              </label>
              <Input
                id="layer-order"
                type="number"
                min={0}
                value={layerOrder}
                onChange={(e) => setLayerOrder(e.target.value)}
                placeholder="Auto-assigned if empty"
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Layer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Layer row
// ---------------------------------------------------------------------------

function LayerRow({
  layer,
  index,
  total,
  onEdit,
  onToggleActive,
  onDelete,
  onMove,
}: {
  layer: AdminLayer;
  index: number;
  total: number;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span className="w-8 text-center text-xs tabular-nums text-muted-foreground">
        {layer.display_order}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {layer.label}
          </span>
          <code className="text-xs text-muted-foreground">{layer.key}</code>
          {!layer.is_active && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              Inactive
            </Badge>
          )}
        </div>
        {layer.description && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {layer.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index === 0}
          onClick={() => onMove('up')}
          title="Move up"
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index === total - 1}
          onClick={() => onMove('down')}
          title="Move down"
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onToggleActive}
          title={layer.is_active ? 'Deactivate' : 'Reactivate'}
        >
          {layer.is_active ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onEdit}
          title="Edit layer"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Delete layer"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------

export function LayersSection() {
  const { refresh } = useLayerVocabulary();
  const admin = useLayerAdmin({ refresh });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
            Depth Levels
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    aria-label="More information about depth levels"
                  >
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  Examples: &ldquo;Summary&rdquo; for a one-paragraph overview,
                  &ldquo;Standard&rdquo; for a typical article, &ldquo;Technical
                  Detail&rdquo; for in-depth specifications. Depth levels help
                  users find the right level of detail for their needs. Items
                  can only have one depth level.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Depth levels describe how detailed an item is, from a quick summary
            to full technical specification.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={admin.openAddLayer}>
          <Plus className="size-3.5" />
          Add Layer
        </Button>
      </div>

      {/* Screen reader live region */}
      <div aria-live="polite" className="sr-only">
        {admin.announcement}
      </div>

      <div className="mt-4 space-y-2">
        {admin.loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!admin.loading && admin.layers.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <Layers
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              No layers defined yet. Add your first content layer to get
              started.
            </p>
          </div>
        )}

        {admin.layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            total={admin.layers.length}
            onEdit={() => admin.openEditLayer(layer)}
            onToggleActive={() => admin.handleToggleActive(layer)}
            onDelete={() => admin.handleDelete(layer)}
            onMove={(dir) => admin.handleMove(layer.id, dir)}
          />
        ))}
      </div>

      <LayerFormDialog
        open={admin.dialogOpen}
        onOpenChange={admin.setDialogOpen}
        editingLayer={admin.editingLayer}
        layerKey={admin.layerKey}
        setLayerKey={admin.setLayerKey}
        layerLabel={admin.layerLabel}
        setLayerLabel={admin.setLayerLabel}
        layerDescription={admin.layerDescription}
        setLayerDescription={admin.setLayerDescription}
        layerOrder={admin.layerOrder}
        setLayerOrder={admin.setLayerOrder}
        saving={admin.saving}
        onSubmit={admin.handleSubmit}
      />

      <p className="mt-6 rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
        New layers added here will appear in the UI immediately. However, API
        validation for metadata updates uses a static fallback list. After
        adding a new layer, update the <code>FALLBACK_LAYERS</code> array in{' '}
        <code>lib/client-config.ts</code> and redeploy for full API support.
      </p>
    </div>
  );
}
