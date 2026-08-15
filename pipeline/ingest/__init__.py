"""Flow 1 — ingestion.

Sources (localfs first) -> provenance register (source_documents-as-register)
+ staged records (content_chunks, q_a_extractions, entity_mentions,
entity_relationships, record_embeddings). See DESIGN.md §2.
"""
