-- Lowercase existing entity_relationships to match new canonical_name storage
UPDATE entity_relationships SET source_entity = LOWER(source_entity);
UPDATE entity_relationships SET target_entity = LOWER(target_entity);
