export interface FilterPreset {
  /** Unique identifier. System presets use deterministic slugs; user presets use `u_` prefix. */
  id: string;
  /** Human-readable name displayed on the chip. */
  name: string;
  /**
   * URL search params string representing the filter combination.
   * Does NOT include leading '?'. Does NOT include sort/order params.
   * Example: "freshness=stale,expired&owner=me"
   */
  params: string;
  /** True for hardcoded system presets. System presets cannot be edited or deleted. */
  isSystem: boolean;
  /** ISO 8601 timestamp. For system presets this is a fixed compile-time value. */
  createdAt: string;
}
