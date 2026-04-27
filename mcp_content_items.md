## Request

- Audit the Q&A pairings

- Identify which Q&As cluster naturally by domain (corporate, security,
  compliance), draft consolidation documents for the factual ones, and use
  Knowledge Hub's tooling to enrich the substantive ones.

- Consolidate the factual reference content into a small number of rich company
  profile documents — Corporate Identity Pack (registration numbers, address,
  VAT, UTR, named contacts, SME status, website), Accreditations &
  Certifications Overview (ISO 27001, ISO 9001, ICO registration, CREST pen
  testing).

- Enrich the security/compliance/product Q&As. Add enough context that Claude
  can construct a proper paragraph from them. A Q&A answer of 56 characters on
  backup storage location should become two or three sentences that explain
  where, why, and what the governance around it is.

**Notes:**

- Create via create_content_item with governance_review_status: 'draft'
- Explicitly tag with a source marker (e.g. consolidation-{client}-april-2026)
  so the batch is identifiable
- Do not trigger classify_content or generate_summary yet — leave that for
  post-approval
- Document any outstanding items or ambiguities with the data e.g., missing
  information, conflicting information,

## Proposed Documents

**1. Corporate Identity Reference Sheet (corporate)**

Consolidate into a single structured reference document — these will almost
always be cited together in bid submissions:

- Company Registration Number (7 chars)
- D-U-N-S Number (9 chars)
- UTR Number (10 chars)
- VAT Registration Number (14 chars)
- Company Website URL (15 chars)
- Charity Registration Status (2 chars — just "No")
- Named Contact Person: Matthew Burgess (15 chars)
- Accounts Contact Email (20 chars)
- Registered Address / Company Name (56–114 chars)
- SIC Codes (70 chars)
- Bank Account — Metro Bank Milton Keynes (137 chars)

**2. Company Profile & Capabilities Overview (corporate)**

These are brief but conceptually distinct from raw reference data — they
describe who example-client is rather than just their identifiers:

- Company Size, Structure & Employee Roles (194 chars)
- SME Status Declaration (194 chars)
- Core Products & Services: Audit System, LMS & Web Design (121 chars)
- Industries & Sectors Served (111 chars)
- Business References availability (89 chars)
- Pre-Employment Verification Checks (154 chars)
- Personnel Screening & DBS Vetting (178 chars)

These collectively form the company narrative for bid Section 1 / About Us
sections.

**3. Social Value Statement (corporate)**

- Employee Wellbeing Initiatives (100 chars)
- Equal Opportunity Policy (93 chars)
- Tackling Economic Inequality (134 chars)
- COVID-19 Recovery: Remote & Flexible Working (121 chars)

Social value sections in bids require narrative; point answers here actively
hurt output quality.

**4. Certifications & Accreditations Overview (compliance)**

- ISO 27001 (182 chars)
- ISO 9001 (165 chars)
- Cyber Essentials Plus (193 chars)
- ICO Registration — ZA123456 (132 chars / 8 chars duplicate)
- GDPR Article 30 RoPA (51 chars)
- Annual Security Audits (196 chars)
- Scope of Data Protection Audits (118 chars)

**5. GDPR & Data Protection Compliance Overview (compliance → security
overlap)**

These span two domains but are thematically unified — a GDPR compliance
narrative:

- Privacy Notice — UK GDPR (56 chars)
- Key Provisions of DPA (149 chars)
- Addressing GDPR in DPIAs (191 chars)
- Data Breach Notification Procedure (90 chars)
- Data Subject Rights Procedures (136 chars)
- Data Minimisation & Accuracy (139 chars)
- Data Retention & Deletion (135 chars)
- Processor Obligation — Data Subject Rights (99 chars)
- HMRC CEST / IR35
- Public Contracts Regulations 2015 s113 (146 chars)

**6. Information Security Controls Reference (security)**

The security Q&As break naturally into thematic sub-groups - create a single
structured doc with clear sections:

- Access Control: Least Privilege, Monthly Reviews, No Shared Accounts, Audit
  Logs, User Accountability
- Physical Security: Clear Screen/Desk Policy, Physical Access Controls,
  Sensitive Areas
- Infrastructure: UK-Only Data Storage, Backup Location, Offsite Backup, Data
  Centre ISO 27001/CE+, SSL Encryption
- Testing & Assurance: CREST Pen Testing, Annual Security Audits
- Incident Management: ISO 27001 Incident Policy, Breach 72-Hour Reporting,
  Staff Breach Disciplinary Process
- Training: Employee Security Training, Privileged User Training, Developer
  OWASP Training, DPO Details

**7. Business Continuity & Service Levels (support + implementation)**

- Four-Hour Support Response SLA (138 chars)
- RPO/RTO Definitions (56 chars)
- Business Continuity & DR Strategy (140 chars)
- Documented DR Plan & Testing (193 chars)
- Implementation Timelines
