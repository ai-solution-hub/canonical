/**
 * Governance preset definitions.
 *
 * Each preset bundles concrete column values for `governance_config`.
 * The server maps preset to column values on write; consumers read
 * columns directly and are unaware of presets.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GovernancePreset = 'light_touch' | 'strict';

export interface GovernancePresetValues {
  posture: 'open' | 'review_on_change';
  timeout_days: number | null;
  quality_score_threshold: number;
  auto_flag_on_quality_drop: boolean;
  auto_flag_on_freshness_transition: boolean;
  auto_flag_cooldown_days: number | null;
}

export interface GovernancePresetLabel {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Concrete column values for each preset. These are written to
 * `governance_config` when a preset is selected.
 */
export const PRESET_VALUES: Record<GovernancePreset, GovernancePresetValues> = {
  light_touch: {
    posture: 'open',
    timeout_days: null,
    quality_score_threshold: 40,
    auto_flag_on_quality_drop: false,
    auto_flag_on_freshness_transition: false,
    auto_flag_cooldown_days: null,
  },
  strict: {
    posture: 'review_on_change',
    timeout_days: 7,
    quality_score_threshold: 60,
    auto_flag_on_quality_drop: true,
    auto_flag_on_freshness_transition: true,
    auto_flag_cooldown_days: 14,
  },
};

/**
 * Human-readable labels for each preset, used in the UI.
 */
export const PRESET_LABELS: Record<GovernancePreset, GovernancePresetLabel> = {
  light_touch: {
    name: 'Light-touch',
    description:
      'All edits land immediately. Low-scoring items surface to your attention, but nothing is blocked.',
  },
  strict: {
    name: 'Strict',
    description:
      'Edits to this domain are held for review. Stale or low-quality items are automatically flagged.',
  },
};

/**
 * Infer preset from existing column values, falling back to 'light_touch'
 * for rows that were created before the preset column existed.
 */
export function inferPreset(posture: string): GovernancePreset {
  return posture === 'review_on_change' ? 'strict' : 'light_touch';
}
