---
name: classification
description: Domain taxonomy guidance for the Knowledge Hub. Covers the two-level taxonomy structure (domains and subtopics), content type classification, confidence interpretation, and when to trigger reclassification. Use when classifying new content, verifying existing classifications, or understanding how the KB is organised.
---

# Classification

Guidance for understanding and working with the Knowledge Hub's content classification system. The KB uses a two-level taxonomy (domains and subtopics) combined with content type classification and confidence scoring.

## Taxonomy Structure

The KB uses a DB-driven taxonomy that can be customised per organisation. The taxonomy is available via the `kb://taxonomy` resource.

### Two-Level Hierarchy

```
Domain (Level 1)
  └── Subtopic (Level 2)
```

**Domains** are broad knowledge areas (e.g., Security, Compliance, Methodology). Each domain contains multiple **subtopics** that provide finer-grained classification.

<!-- TAXONOMY_INJECT_START -->
### Full Taxonomy (15 domains, 56 subtopics)

```
Security (5 subtopics)
  ├── data-protection (GDPR, data handling, privacy policies, data retention and disposal)
  ├── cyber-security (Threat detection, vulnerability management, penetration testing, security monitoring)
  ├── encryption (Data encryption at rest and in transit, key management, cryptographic standards)
  ├── access-control (Authentication, authorisation, role-based access, multi-factor authentication)
  └── iso-27001 (ISO 27001 certification, ISMS, security management framework compliance)

Compliance (9 subtopics)
  ├── standards (Industry standards compliance, best practice frameworks, governance requirements)
  ├── regulatory (Legal and regulatory requirements, sector-specific regulations, compliance obligations)
  ├── audit (Audit processes, evidence gathering, compliance reporting, third-party audits)
  ├── certification (Professional certifications, organisational accreditations, quality marks)
  ├── health-and-safety (Health and safety policy, risk assessments, incident reporting, RIDDOR, CDM regulations)
  ├── environmental (Carbon reduction plan, net zero targets, environmental policy, ISO 14001, sustainability, PPN 06/20)
  ├── modern-slavery (Modern slavery statement, supply chain due diligence, forced labour prevention, PPN 02/23)
  ├── equalities (Equalities Act 2010, written equalities statement, equal opportunities policy, diversity and inclusion)
  └── safeguarding (Safeguarding policy, DBS checks, vulnerable persons, duty of care, child protection)

Implementation (4 subtopics)
  ├── deployment (Solution rollout, environment setup, go-live planning, deployment processes)
  ├── migration (Data migration, system transition, legacy replacement, cutover planning)
  ├── onboarding (Client onboarding, user training, adoption support, change management)
  └── integration (API integration, third-party systems, data exchange, interoperability)

Support (4 subtopics)
  ├── sla (Service level agreements, uptime guarantees, response times, performance targets)
  ├── helpdesk (Support desk operations, ticket management, escalation procedures, user support)
  ├── maintenance (Scheduled maintenance, patching, updates, system health monitoring)
  └── incident (Incident response, disaster recovery, business continuity, root cause analysis)

Corporate (7 subtopics)
  ├── company-info (Company overview, history, mission, organisational structure)
  ├── insurance (Professional indemnity, public liability, cyber insurance, coverage details)
  ├── references (Client references, case studies, testimonials, similar contract experience)
  ├── staffing (Team structure, key personnel, CVs, recruitment and retention)
  ├── supply-chain (Supply chain management, prompt payment, subcontractor oversight, PPN 02/23)
  ├── financial-standing (Turnover thresholds, credit checks, bankruptcy declarations, financial statements, accounts)
  └── methodology (Method statements, service delivery approach, working arrangements, key steps, efficiencies, risk mitigation)

Product-Feature (4 subtopics)
  ├── functionality (Core product features, capabilities, modules, feature descriptions)
  ├── technical (Technical architecture, infrastructure, hosting, technology stack)
  ├── reporting (Reporting capabilities, dashboards, analytics, management information)
  └── usability (User experience, accessibility, interface design, ease of use)

Methodology (4 subtopics)
  ├── approach (Delivery methodology, project approach, ways of working, agile/waterfall)
  ├── project-management (Project governance, milestones, risk management, stakeholder communication)
  ├── quality (Quality assurance, testing strategy, acceptance criteria, continuous improvement)
  └── delivery (Delivery timelines, phased rollout, resource planning, capacity management)

Safeguarding-child-protection (0 subtopics)

Safeguarding-adults (0 subtopics)

Multi-academy-trusts (0 subtopics)

Education (0 subtopics)

Products-services (0 subtopics)

Legislation-policy (7 subtopics)
  ├── kcsie (KCSIE statutory guidance, safeguarding requirements for schools and colleges)
  ├── education-act-dfe (Education Act provisions, DfE policy updates, statutory instruments)
  ├── health-social-care-legislation (Health and Social Care Act, CQC regulations, care standards legislation)
  ├── gdpr-data-protection (GDPR compliance, Data Protection Act 2018, ICO guidance and enforcement)
  ├── funding-policy (Education funding formulae, ESFA allocations, grant conditions, pupil premium)
  ├── safeguarding-guidance (Safeguarding statutory guidance, Working Together, local safeguarding partnerships)
  └── cpd-requirements (Continuing professional development requirements, training standards, competency frameworks)

Market-intelligence (5 subtopics)
  ├── competitor-products (Competitor product launches, service offerings, feature comparisons)
  ├── competitor-market-activity (Competitor contract wins, partnerships, market positioning)
  ├── competitor-leadership (Competitor leadership changes, strategic announcements, organisational restructuring)
  ├── market-trends (Sector market trends, growth areas, emerging technologies, spending patterns)
  └── procurement-activity (Public sector procurement notices, framework opportunities, tender activity)

Sector-news (7 subtopics)
  ├── mat-leadership (Multi-academy trust CEO appointments, board changes, leadership announcements)
  ├── mat-restructuring (MAT mergers, trust splits, school transfers between trusts)
  ├── mat-audits-ofsted (Ofsted inspection outcomes for MATs, ESFA financial audits, trust reviews)
  ├── education-sector-audits (School inspections, college reviews, university quality assessments)
  ├── health-sector-audits (CQC inspections, NHS trust reviews, health provider quality assessments)
  ├── local-authority-inspections (Local authority SEND inspections, children's services reviews, social care assessments)
  └── safeguarding-practice (Safeguarding practice reviews, serious case reviews, SCR learning updates)
```
<!-- TAXONOMY_INJECT_END -->

### Using the Taxonomy for Search

When a user's query maps clearly to a domain, use domain filtering in search:
- "ISO 27001" maps to Security domain
- "PRINCE2 methodology" maps to Methodology domain
- "GDPR compliance" could map to Security (data-protection) OR Compliance (regulatory) — search both or search unfiltered

When the mapping is ambiguous, do not filter — let the semantic search handle relevance ranking.

<!-- CONTENT_TYPES_INJECT_START -->
## Content Types

Each KB item is classified with one content type:

| Content Type | Description | Typical Use |
|-------------|-------------|-------------|
| **article** | In-depth knowledge base article | General reference material |
| **blog** | Blog-style content | Thought leadership, updates |
| **pdf** | Content extracted from PDF documents | Imported documentation |
| **note** | Short-form notes | Quick captures, meeting notes |
| **research** | Research documents and findings | Market research, analysis |
| **other** | Content that doesn't fit other categories | Miscellaneous |
| **q_a_pair** | Question and answer pair with standard/advanced answers | Pre-approved form responses |
| **case_study** | Project case study with outcomes | Evidence for form responses |
| **policy** | Organisational policy or procedure | Authority for compliance claims |
| **certification** | Certification or accreditation record | Proof of compliance |
| **compliance** | Compliance documentation | Regulatory evidence |
| **methodology** | Methodology or approach description | Process evidence for forms |
| **capability** | Service or product capability statement | Capability evidence |
| **product_description** | Product or service description | Marketing and technical detail |
| **document** | Generic content item | General knowledge |
<!-- CONTENT_TYPES_INJECT_END -->

### Content Type Selection Guidance

When classifying content, choose the most specific type:
- If it has a question and an answer format, it is a `q_a_pair`
- If it describes a past project with outcomes, it is a `case_study`
- If it is an organisational rule or procedure, it is a `policy`
- If it describes how something is done, it is a `methodology`
- If it proves a certification exists, it is a `certification`
- If it describes what an organisation can do, it is a `capability`

**Avoid `other`** — it provides no useful classification signal. If content does not fit, consider whether it needs restructuring or splitting.

## Classification Confidence

The AI classification system assigns a confidence score (0-1) to each classification:

| Confidence | Interpretation | Action |
|------------|---------------|--------|
| **>0.8** | Strong classification — the AI is confident in domain and subtopic | Accept as-is |
| **0.6-0.8** | Moderate classification — likely correct but worth a glance | Review if flagged |
| **<0.6** | Low confidence — may be misclassified or genuinely ambiguous | Manual review needed |

### Factors Affecting Confidence

- **Clear domain language**: Content using domain-specific terminology (e.g., "penetration testing", "ISO 27001 Annex A") gets high confidence
- **Cross-domain content**: Content spanning multiple domains gets lower confidence as the AI must choose one primary domain
- **Generic language**: Content with non-specific language ("we follow best practices") gets lower confidence
- **Short content**: Very brief content provides fewer signals for classification

### Handling Low Confidence

When classification confidence is low:
1. Read the actual content (use `get` tool)
2. Check if the assigned domain/subtopic makes sense
3. If incorrect, use `classify_content` to trigger reclassification
4. If the content genuinely spans multiple domains, assign the primary domain and note in metadata

## When to Trigger Reclassification

Reclassify content (using the `classify_content` tool) when:

- Content has been substantially updated or rewritten
- Classification confidence is below 0.6
- A user reports misclassification
- The taxonomy has been restructured (new domains or subtopics)
- Content was imported in bulk and not individually reviewed

### Reclassification Restrictions

- Only editors and admins can trigger reclassification
- Reclassification uses AI and consumes API calls — avoid running on unchanged content
- After reclassification, verify the result before accepting

## Suggesting Domain/Subtopic for New Content

When a user creates new content or asks for classification guidance:

1. **Identify the primary topic**: What is this content fundamentally about?
2. **Check the taxonomy**: Use `kb://taxonomy` to see available domains and subtopics
3. **Match to domain**: Which domain best captures the primary topic?
4. **Match to subtopic**: Which subtopic within that domain is the best fit?
5. **Assess content type**: What format is this content in?

**Decision tree:**
```
Is it about protecting data/systems/information?
  → Security domain → match to subtopic

Is it about meeting standards/regulations/audits/H&S/environmental?
  → Compliance domain → match to subtopic

Is it about deployment/migration/onboarding/integration?
  → Implementation domain → match to subtopic

Is it about live service support/SLAs/incidents/maintenance?
  → Support domain → match to subtopic

Is it about the company itself/financials/insurance/references/staffing?
  → Corporate domain → match to subtopic

Is it about product capabilities/architecture/reporting/UX?
  → Product-Feature domain → match to subtopic

Is it about delivery methodology/project management/quality/approach?
  → Methodology domain → match to subtopic

Does it span multiple domains?
  → Choose the PRIMARY domain (where the core value is)
  → Note secondary relevance in tags or metadata
```

## Anti-Patterns

**Do not:**
- Classify content as `other` when a more specific type applies — `other` provides no useful signal
- Trigger reclassification on unchanged content — it wastes API calls and may flip correct classifications
- Force a single domain when content genuinely spans two — assign the primary domain and note the secondary in tags
- Filter search by domain when the query is ambiguous — let the semantic search handle relevance ranking
- Assume low confidence means wrong classification — it may mean the content is genuinely cross-domain
- Use classification confidence as a quality score — confidence measures taxonomy fit, not content quality

**Do:**
- Check the taxonomy (`kb://taxonomy`) before suggesting a domain — the available domains may differ from expectations
- Recommend reclassification when content has been substantially edited, not after minor updates
- Flag items with confidence <0.6 for human review rather than silently accepting
- Use content type to inform evidence strength in form responses (Q&A pairs > policies > case studies)
- Note when a subtopic might be a better fit than the current assignment, even if the domain is correct

## Related Skills

- **@search-strategy** — How classification affects search filtering
- **@content-governance** — How classification confidence affects quality flags
- **@completing-forms** — How content types map to evidence strength in form responses
