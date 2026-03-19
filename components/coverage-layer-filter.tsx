'use client';

import { isFeatureEnabled } from '@/lib/client-config';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageLayerFilterProps {
  value: string | null;
  onLayerChange: (layer: string | null) => void;
}

// ---------------------------------------------------------------------------
// Coverage Layer Filter
// ---------------------------------------------------------------------------

export function CoverageLayerFilter({
  value,
  onLayerChange,
}: CoverageLayerFilterProps) {
  const { layers } = useLayerVocabulary();

  // Only render when content_layers feature is enabled
  if (!isFeatureEnabled('content_layers')) {
    return null;
  }

  return (
    <Select
      value={value ?? 'all'}
      onValueChange={(v) => onLayerChange(v === 'all' ? null : v)}
    >
      <SelectTrigger size="sm" className="w-[180px]">
        <SelectValue placeholder="All layers" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All layers</SelectItem>
        {layers.map((layer) => (
          <SelectItem key={layer.key} value={layer.key}>
            {layer.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
