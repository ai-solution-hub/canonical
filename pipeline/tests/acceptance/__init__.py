"""id-465 ported-contract acceptance suite (DESIGN.md §6).

Each ratified contract ports as ONE behaviour-first test module — never as
ported machinery (DR-152). Contract → module map:

- SEED CONTRACT id parity (frozen uuid5)      → test_seed_contract_parity.py
- Naming stability (DR-140/DR-147/DR-105)     → test_naming_stability.py
- Two gates / retention classes (R1/R2,
  DR-025, DR-148 phase-1 scope)               → test_binding_gate_retention.py
- No old-tree machinery + no DDL (DR-152)     → test_no_machinery.py
- Mention anchoring (DR-135)                  → covered behaviourally in
  tests/test_main_helpers.py (refusal path) — asserted structurally here too.
- Unpublished-never-cited (DR-143)            → tests/produce/test_main.py's
  three-way matrix (draft excluded / unpublished-source citation degradation).
- Coverage at the knowledge grain (DR-141,
  DR-153: no residuals)                       → tests/produce/test_main.py::
  test_topic_grain_covers_every_published_pair_dr141.
- Byte-faithful frontmatter (DR-144/id-440)   → tests/produce/test_frontmatter.py.
"""
