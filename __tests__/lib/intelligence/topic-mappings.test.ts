/**
 * Unit tests for topic-to-sector mapping used by hierarchical guide
 * generation.
 */
import { describe, it, expect } from 'vitest';
import {
  findParentSector,
  TOPIC_TO_SECTOR_MAP,
} from '@/lib/intelligence/topic-mappings';

describe('findParentSector', () => {
  const sectors = ['Education', 'Health & Social Care'];

  it('returns the mapped sector for a known topic', () => {
    expect(findParentSector('KCSIE', sectors)).toBe('Education');
    expect(findParentSector('CQC', sectors)).toBe('Health & Social Care');
    expect(findParentSector('Ofsted', sectors)).toBe('Education');
  });

  it('performs case-insensitive matching', () => {
    expect(findParentSector('kcsie', sectors)).toBe('Education');
    expect(findParentSector('OFSTED', sectors)).toBe('Education');
    expect(findParentSector('cqc', sectors)).toBe('Health & Social Care');
  });

  it('returns undefined for unmapped topics', () => {
    expect(findParentSector('Unknown Topic', sectors)).toBeUndefined();
    expect(findParentSector('Random', sectors)).toBeUndefined();
  });

  it('returns undefined when mapped sector is not in the profile sectors', () => {
    // KCSIE maps to Education, but Education is not in the sectors list
    expect(findParentSector('KCSIE', ['Health & Social Care'])).toBeUndefined();
  });

  it('accepts a custom mapping', () => {
    const customMap = { 'My Topic': 'Education' };
    expect(findParentSector('My Topic', sectors, customMap)).toBe('Education');
    // Default mappings should not apply
    expect(findParentSector('KCSIE', sectors, customMap)).toBeUndefined();
  });

  it('exports a default mapping with Education and Health & Social Care entries', () => {
    const educationTopics = Object.entries(TOPIC_TO_SECTOR_MAP).filter(
      ([, sector]) => sector === 'Education',
    );
    const healthTopics = Object.entries(TOPIC_TO_SECTOR_MAP).filter(
      ([, sector]) => sector === 'Health & Social Care',
    );

    expect(educationTopics.length).toBeGreaterThan(0);
    expect(healthTopics.length).toBeGreaterThan(0);
  });
});

describe('TOPIC_TO_SECTOR_MAP exact counts', () => {
  it('maps exactly 7 topics to Education', () => {
    const educationTopics = Object.entries(TOPIC_TO_SECTOR_MAP).filter(
      ([, sector]) => sector === 'Education',
    );
    expect(educationTopics).toHaveLength(7);
  });

  it('maps exactly 5 topics to Health & Social Care', () => {
    const healthTopics = Object.entries(TOPIC_TO_SECTOR_MAP).filter(
      ([, sector]) => sector === 'Health & Social Care',
    );
    expect(healthTopics).toHaveLength(5);
  });

  it('contains exactly 12 mappings total', () => {
    expect(Object.keys(TOPIC_TO_SECTOR_MAP)).toHaveLength(12);
  });
});
