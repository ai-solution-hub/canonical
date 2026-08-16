# Zero-egress means no client data at rest in shared infrastructure and no non-essential egress

Crosswalk: DR-043

## Context

The platform's confidentiality commitment to clients is stated as "zero egress", which was
never literally true — the system calls a hosted model provider and a hosted database. Left
undefined, the commitment is unauditable and every new provider or stage re-argues from scratch
what it permits.

## Decision

Zero-egress means **no client data at rest in shared multi-tenant third-party infrastructure,
and no non-essential egress**. Terms-protected model and transit egress — a no-train,
zero-retention model provider, and the client's own single-tenant database project — is the
accepted, bounded exception.

## Alternatives considered

- **Read the commitment literally** — rejected: it was never the intent and is unimplementable
  for an LLM pipeline.
- **Leave the term undefined and judge per deployment** — rejected: it makes the commitment
  unauditable and pushes the judgement onto whoever wires the next integration.

## Consequences

- The ingestion pipeline runs on-premises, where "on-prem" covers both residence and
  processing; the application runs on managed hosting.
- Data-plane agents run inside the client's own isolation boundary; the central control plane
  is telemetry-only.
- Any new provider, stage or third-party service is checked against this definition before it
  is wired. The two questions are whether client data comes to rest in shared infrastructure,
  and whether the egress is both essential and terms-protected.
