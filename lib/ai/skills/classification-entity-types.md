# Entity Type Reference

This document provides detailed definitions for the 12 entity types used in
Knowledge Hub content classification. Load this alongside the main
classification skill when entity extraction accuracy is critical.

Each type includes a diagnostic test question, inclusion/exclusion examples, and
boundary case resolutions derived from the authoritative entity type taxonomy
specification.

---

### organisation

**Definition:** A named legal entity, government body, standards body,
professional association, or formal institutional body that exists as a
registered or officially recognised entity.

**The Test:** "Does this entity have a legal registration, government charter,
or formal institutional standing? Could I look up its official website, company
number, or regulatory registration?"

**Include:** Example Client Ltd, NHS, HMRC, ICO, BSI, CREST, Companies House

**Exclude:** "the organisation" (pronoun, not named), "IT Department" (internal
division), "senior management" (informal grouping), "public sector" (sector, not
organisation), "Bedford Technology Park" (location)

**Boundary cases:**

- CREST as organisation vs certification: "a member of CREST" = organisation;
  "CREST-accredited" = certification. Context determines type.
- BSI as organisation vs standard prefix: BSI is the British Standards
  Institution (organisation). "BS 5839" is a standard it publishes.
- Crown Commercial Service is an organisation. G-Cloud (which CCS operates) is a
  framework. Do not type CCS as framework.

---

### certification

**Definition:** A formal credential, accreditation, or compliance mark that an
organisation or individual holds, seeks, or maintains, issued by an independent
certifying body after assessment against defined criteria.

**The Test:** "Is this something an organisation or person obtains by being
assessed against criteria, and that can be displayed as a credential? Does it
have an issuing body, a validity period, and a renewal cycle?"

**Include:** ISO 27001 (when held), Cyber Essentials, Cyber Essentials Plus, PCI
DSS, SOC 2, CREST accreditation, CISSP

**Exclude:** ISMS/QMS/EMS (management systems, not certifications — extract the
underlying cert instead), "completed GDPR awareness training" (training
activity), "GDPR compliant" (compliance status — the regulation is type
`regulation`)

**Boundary cases:**

- ISO 27001 as certification vs standard: holding the certification or
  undergoing audits = `certification`. Discussing the published requirements or
  clauses = `standard`. In bid documents, prefer `certification`.
- Cyber Essentials vs Cyber Essentials Plus: distinct certifications — extract
  whichever is mentioned, do not collapse.
- ISMS/QMS/EMS: prefer extracting the underlying certification (ISO 27001,
  ISO 9001) rather than the management system itself.

---

### regulation

**Definition:** A law, statutory instrument, government regulation, or piece of
statutory guidance that carries legal force — meaning non-compliance has legal
consequences imposed by a government or regulatory body.

**The Test:** "Does non-compliance with this carry legal penalties, enforcement
action, or statutory consequences? Was it enacted by a legislature or issued as
binding guidance by a government body?"

**Include:** Data Protection Act 2018, GDPR, Equality Act 2010, RIDDOR, Working
Together to Safeguard Children, Keeping Children Safe in Education, PPN 06/20

**Exclude:** "data protection" (generic concept), "consent" / "legitimate
interest" (GDPR sub-concepts), "data subject access request" (mechanism within
GDPR), "county lines criminal exploitation" (safeguarding topic, not regulation)

**Boundary cases:**

- Statutory guidance vs framework: legal consequence is the deciding factor.
  "Working Together to Safeguard Children" has legal force = `regulation`. "NCSC
  10 Steps to Cyber Security" does not = `framework`.
- PPN (Procurement Policy Notes): binding on government buyers with contractual
  consequences. Type as `regulation`.
- Data Protection Act 2018 vs GDPR: both valid as separate regulations.

---

### framework

**Definition:** A published, externally maintained, structured set of
principles, practices, or assessment criteria that organisations can voluntarily
adopt — but that does not carry legal force and is not a certifiable standard.

**The Test:** "Is this a structured body of guidance, published by an external
organisation, that another organisation could independently choose to adopt? AND
does it lack legal force AND is it not a certifiable standard?"

**Include:** OWASP, OWASP Top 10, ITIL, COBIT, G-Cloud, G-Cloud 14, NCSC 10
Steps to Cyber Security, Social Value Model, Education Inspection Framework

**Exclude:** Information Security Policy (internal policy — Rule 3), ISMS
(management system, not published framework), "information governance" (generic
concept), "Records of Processing Activity" (GDPR artefact), "CIA Triad"
(security principle, not framework)

**Boundary cases:**

- OWASP as framework vs organisation: "OWASP Top 10 vulnerabilities" =
  framework. "OWASP publishes..." = organisation.
- PRINCE2 as framework vs methodology: type as `methodology` — its primary
  identity is a project management approach.
- Statutory guidance that looks like a framework: if non-compliance carries
  legal consequences, it is `regulation`, not `framework`.

---

### capability

**Definition:** A named, distinct service offering, professional competency, or
operational function that the organisation provides to external clients or
maintains as a core differentiating skill.

**The Test:** "Is this a specific, named service or competency that the
organisation would list on its website or in a capabilities statement as
something it offers to clients?"

**Include:** penetration testing (when offered as a named service), 24/7 managed
SOC, incident response services, ISO 27001 implementation support, security
consultancy

**Exclude:** Information Security Policy (internal policy — Rule 3),
"encryption" (generic concept), "Data Protection Officer" (job title — Rule 4),
"data wiping" (activity in passing), "information security" (abstract domain)

**Boundary cases:**

- "Penetration testing" as capability vs concept: "we provide penetration
  testing services" = capability. "Penetration testing should be conducted
  annually" = generic concept. When in doubt, exclude.
- Capability vs methodology: capability = WHAT the organisation does.
  Methodology = HOW. "Project management" is a capability. "PRINCE2" is a
  methodology.
- Capability vs product: if it has a branded name and is sold as a distinct
  product, use `product`. "example-client Audit System" = product. "Security auditing" =
  capability.

---

### person

**Definition:** A named individual human being, identified by personal name
(given name, surname, or both).

**The Test:** "Is this the actual name of a specific, identifiable individual
person? NOT a job title, role description, or generic reference?"

**Include:** Matthew Burgess, Jane Smith, John Doe, Alan Turing, Tim Berners-Lee

**Exclude:** Managing Director (job title — Rule 4), "the DPO" (role reference),
"Client Project Lead" (role description), "the project team" (group reference),
"IT Director" (job title)

**Boundary cases:**

- Name with title embedded: "Matthew Burgess, Managing Director" — extract
  "Matthew Burgess" as `person`. Do not extract "Managing Director" separately.
- Canonical name consistency: "Matthew Burgess", "Matt Burgess", "Matthew (MD,
  Example Client Ltd)" all resolve to canonical name "Matthew Burgess".
- "example-client Director" is a role title, not a person — exclude.

---

### technology

**Definition:** A named commercial software platform, cloud service,
infrastructure product, or specific technical tool that an organisation deploys,
operates, or integrates with.

**The Test:** "Is this a specific, named software product, cloud service, or
technical platform that can be purchased, subscribed to, or downloaded? Does it
have a vendor, a version, and a product page?"

**Include:** Microsoft Azure, AWS, Active Directory, SharePoint, Microsoft 365,
GitHub, Docker, PostgreSQL

**Exclude:** HTTPS/SSH/TLS (protocols, not deployable technologies),
PDF/CSV/JSON (file formats), AES-256/RSA (cryptographic algorithms),
JavaScript/Python (programming languages), "cloud computing" (generic category),
"encryption" (concept, not named product)

**Boundary cases:**

- Azure vs "cloud computing": "Azure" = specific named platform (`technology`).
  "Cloud computing" = generic category — exclude.
- SIEM as technology vs concept: prefer extracting the specific product name
  (Splunk, QRadar, Sentinel). Generic "SIEM" may be excluded.
- Technology vs product: `technology` = infrastructure the org uses internally.
  `product` = something the org sells. Azure is `technology`. example-client Audit System
  is `product`.

---

### project

**Definition:** A named project, programme, contract, or initiative with a
defined scope, timeline, and identity — something that was initiated, executed,
and (usually) completed.

**The Test:** "Is this a named piece of work with a start, middle, and (planned)
end? Does it have a project name, a client, and a scope?"

**Include:** NHS Wales Digital Transformation Programme, Project Phoenix, Cloud
Migration Programme, named contracts discussed as bodies of work

**Exclude:** "cloud migration" (generic activity description), "Bedford
Technology Park" (location), "example-client Audit System" (product, not project),
"G-Cloud Lot 2" (framework category)

**Boundary cases:**

- Named project vs generic activity: "Our ISO 27001 implementation project" is
  borderline. If it has a specific project name, extract it. If described
  generically, exclude.
- Contract as project: a named contract can be a project when discussing
  delivery. Generic contract types ("service level agreement") are not entities.

---

### sector

**Definition:** A named industry vertical, market segment, or client sector that
the organisation operates in, delivers to, or has experience with.

**The Test:** "Is this a recognised industry classification or market segment?
Could it appear as a category in a government procurement classification or SIC
code grouping?"

**Include:** public sector, healthcare, education, financial services, defence,
central government, local government, housing

**Exclude:** "England" (geographic region), "vulnerable adults" (demographic
description), "county lines criminal exploitation" (social issue), overly broad
categories used as catch-alls

**Boundary cases:**

- "NHS" as sector vs organisation: NHS is an `organisation`. "Healthcare" is a
  `sector`. "We deliver to the NHS" = extract NHS as organisation. "We work in
  the healthcare sector" = extract healthcare as sector.
- "Education" as sector vs generic word: "education sector services" = sector.
  "Staff education and training" = generic word — not an entity.
- "Safeguarding" as sector vs capability vs concept: as a market segment =
  `sector`. As a named service = `capability`. As a bare concept = exclude.

---

### product

**Definition:** A named commercial software product, platform, service package,
or branded offering that the organisation creates, sells, or offers to clients.

**The Test:** "Is this a named thing that the organisation sells, licenses, or
provides to its clients as a branded offering? Does it have a product name, a
feature set, and a target customer?"

**Include:** example-client Audit System, example-client LMS, WordPress (when offered as a product
to clients), named service packages with distinct brand identity

**Exclude:** "professional indemnity insurance" (insurance category), "standard
support" (pricing tier), "content management system" (generic category), "single
sign-on" (feature, not product), internal tools not sold to clients

**Boundary cases:**

- Product vs technology: products are things the org sells; technologies are
  things the org uses. Azure = `technology`. example-client Audit System = `product`.
  SharePoint can be either depending on context.
- example-client LMS as product vs capability: "example-client LMS" = named `product`. "Learning
  management" = `capability`.

---

### standard

**Definition:** A published, voluntary technical specification, code of
practice, or normative document issued by a recognised standards body (ISO, BSI,
W3C, IEEE, HL7) that defines requirements, guidelines, or characteristics.

**The Test:** "Is this a specific, numbered document published by a standards
body? Can I find it in a standards catalogue with a document number?"

**Include:** BS 5839, BS 5306, WCAG 2.1, WCAG 2.2, HL7, FHIR, IEEE 802.11, ISO
27001 (when discussing the published specification's content)

**Exclude:** "Clear Desk Policy" (internal policy — Rule 3), "non-disclosure
agreement" (contract type), AES-256 (algorithm specification), HTTPS (protocol),
GDPR (regulation with legal force — use `regulation`), ITIL (management
framework — use `framework`)

**Boundary cases:**

- ISO 27001 as standard vs certification: discussing the published document's
  requirements = `standard`. Discussing holding the certification =
  `certification`. In bid documents, prefer `certification`.
- WCAG as standard vs regulation: WCAG remains a `standard` (published by W3C)
  even when regulations mandate compliance. The regulation is a separate entity.
- "BS EN ISO 27001" and "ISO 27001" are the same standard — canonicalise to the
  most commonly used form.

---

### methodology

**Definition:** A named, recognised approach, method, or delivery discipline for
how work is planned, executed, or managed — a "way of doing things" that has an
independent identity, a body of literature, and often a certification path.

**The Test:** "Is this a named approach to delivering work that has its own body
of knowledge, published literature, or professional community? Could someone
take a course in it?"

**Include:** Agile, Scrum, Kanban, Waterfall, PRINCE2, Lean, Six Sigma, DevOps,
DevSecOps, Design Thinking, User-Centred Design

**Exclude:** "Staff Security Breach Process" (internal procedure — Rule 3),
"Clear Desk Policy" (internal policy — Rule 3), "data wiping" (activity),
"Principle of Least Privilege" (security principle, not methodology),
"continuous improvement" (generic description), ITIL/COBIT (frameworks, not
methodologies)

**Boundary cases:**

- Agile as methodology vs generic adjective: "we use Agile methodology" =
  methodology. "We take an agile approach to..." (lowercase, generic) = not a
  named methodology. Look for capitalisation and context.
- PRINCE2 as methodology vs framework: PRINCE2 is primarily a project management
  methodology. Type as `methodology`.
- CIA Triad is NOT a methodology — it is a security model/concept. Exclude.
- DevOps as methodology vs culture: "our DevOps methodology" = methodology. "A
  DevOps culture" (generic) = consider excluding.
