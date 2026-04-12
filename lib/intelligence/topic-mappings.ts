// lib/intelligence/topic-mappings.ts
//
// Maps key topics to their parent sector for hierarchical guide generation.
// Used by createIntelligenceGuide() to nest topic sections under sector
// sections. Topics not present in the map remain top-level.
//
// Default mappings cover the example-client Design client. Additional clients can
// override or extend via per-client configuration when multi-client
// support is added.

/**
 * Default topic-to-sector mapping.
 *
 * Keys are topic names (case-insensitive matching is performed by the
 * consumer). Values are the sector name the topic should nest under.
 */
export const TOPIC_TO_SECTOR_MAP: Record<string, string> = {
  // Education sector topics
  KCSIE: 'Education',
  Ofsted: 'Education',
  Safeguarding: 'Education',
  'Curriculum Design': 'Education',
  'Special Educational Needs': 'Education',
  SEND: 'Education',
  'Early Years': 'Education',

  // Health & Social Care sector topics
  CQC: 'Health & Social Care',
  'CQC inspections': 'Health & Social Care',
  'Mental Health': 'Health & Social Care',
  'Adult Social Care': 'Health & Social Care',
  'Care Quality': 'Health & Social Care',
};

/**
 * Look up the parent sector for a given topic.
 *
 * Performs case-insensitive matching against the mapping keys.
 * Returns undefined if no mapping exists (topic stays top-level).
 */
export function findParentSector(
  topicName: string,
  sectorNames: string[],
  mapping: Record<string, string> = TOPIC_TO_SECTOR_MAP,
): string | undefined {
  // Try exact match first (case-insensitive)
  const normalisedTopic = topicName.toLowerCase();
  for (const [topic, sector] of Object.entries(mapping)) {
    if (topic.toLowerCase() === normalisedTopic) {
      // Only return if the sector actually exists in the profile
      if (sectorNames.some((s) => s.toLowerCase() === sector.toLowerCase())) {
        return sector;
      }
    }
  }
  return undefined;
}
