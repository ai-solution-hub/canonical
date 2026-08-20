# bid-packs — real UK procurement packs and reference corpora (public documents)

Fixture set for id-470 (procurement rebuild). Packs stay **committed** (owner ruling S578, Q8): they are public documents, CI and per-client dogfooding seeding need them reachable, and `MANIFEST.json` carries per-file sizes + sha256 so any copy can be verified or re-downloaded from the source URLs.

| Pack | Title | Files | Size | Source | README |
| --- | --- | ---: | ---: | --- | --- |
| `RM1557.15` | Agreement: G-Cloud 15 Agreement ID: RM1557.15 URL: | 73 | 11.4 MB | https://www.find-tender.service.gov.uk/Notice/067801-2025 | yes |
| `RM6232` | Agreement: Facilities Management and Workplace Services Agreement ID: RM6232 URL: | 21 | 17.7 MB | https://www.gca.gov.uk/agreements/RM6232 | yes |
| `RM6242` | — | 16 | 10.1 MB | — | **missing** |
| `RM6264` | Agreement: Facilities Management and Workplace Services DPS Agreement ID: RM6264 URL: | 60 | 15.4 MB | https://www.gca.gov.uk/agreements/RM6264 | yes |
| `RM6267` | Agreement: Construction Works and Associated Services 2 (CWAS2) / ProCure 23 (P23) | 7 | 2.2 MB | https://www.gca.gov.uk/agreements/RM6267 | yes |
| `cas-version-5` | Reference: Common Assessment Standard - Question Set URL: | 2 | 0.9 MB | https://builduk.org/wp-content/uploads/2025/07/Common-Assessment-Standard-Question-Set-Version-5.pdf | yes |
| `ppn-03-24` | Reference: PPN 03/24: Standard Selection Questionnaire (SQ) URL: | 6 | 1.4 MB | https://www.gov.uk/government/publications/ppn-0324-standard-selection-questionnaire-sq | yes |

Regenerate: `python3 scripts/bid_packs_manifest.py` (from the repo root).
