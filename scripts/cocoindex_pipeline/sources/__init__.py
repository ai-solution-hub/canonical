"""cocoindex `Source` adapters package (ID-132 {132.4} G-SOURCE).

Hand-rolled cocoindex sources over Canonical L-records, in the shape of the
existing `scripts/cocoindex_pipeline/url_source.py` (structural
`runtime_checkable` protocol conformance, no eager `cocoindex` import for
collection safety). `l_records.py` hosts the OKF concept producer's Source
adapter (`LRecordsSource`) — see
`docs/specs/id-132-okf-concept-producer/TECH.md` §"The Source adapter over
L-records" for the architecture this package implements.
"""
