# ADR 0001: Architecture Principles

## Status

Accepted. Updated 2026-05-25 for the modular agentic workspace
direction.

## Context

SpreadbreadAI must remain open-source, local-first, useful for
spreadsheet-heavy professional workflows, and safe enough for sensitive
business documents. The first implementation is a LibreOffice Calc
extension backed by a local Python daemon. The next direction is a
provider-neutral engine that can support LibreOffice/local xlsx, Google
Sheets, Google Docs, Excel, MCP clients, and local skills without
becoming an expensive generic agent platform.

## Decisions

1. **Local-first modular monolith.** The development/beta architecture
   is one local daemon with SQLite/local files. No required hosted
   service, paid API, Postgres server, vector database, or message
   queue.
2. **Provider adapters at the edge.** LibreOffice/local xlsx is the
   first provider. Google Sheets, Google Docs, and Excel are adapters
   behind shared document/operation contracts.
3. **Typed operations before mutation.** Agents, skills, and MCP tools
   propose operations. Provider mutation happens only through the apply
   pipeline.
4. **Policy is enforced in code, not in prompts.** Tool exposure and
   execution are filtered by mode, trust policy, resource, provider
   capability, and risk.
5. **Artifact-centered UX.** Chat can start work, but findings,
   operations, diffs, validation, dependency impact, and audit are the
   durable product objects.
6. **Review is risk-based.** Default review mode requires approval for
   writes. Locked mode requires per-item approval. Direct mode is
   opt-in, bounded, validated, versioned, and audited.
7. **MCP is an integration boundary, not a bypass.** External clients
   use the same tool registry and permission policy as the local agent.
8. **Skills before plugins.** Prefer local markdown/config skills for
   repeatable workflows. Add Python plugin runtimes only after skills
   and static adapters prove insufficient.
9. **Models are replaceable.** Ollama/local models are the default.
   Cloud LLMs are optional adapters with user-supplied credentials.
10. **Versions and audit are core product data.** Every meaningful
    state transition is traceable; apply is idempotent per proposal or
    operation batch.

## Consequences

- The current LibreOffice path remains valuable and should be hardened
  rather than replaced.
- The core daemon grows explicit contracts: operation IR, provider
  capabilities, agent modes, runs, policy, skills, and artifacts.
- Expansion to Google/Office happens after these contracts exist.
- Contributors must not add direct provider write paths from model,
  skill, or MCP code.
- SQLite remains acceptable until real shared/team usage proves the
  need for Postgres.
- UI work should expose artifacts and timelines, not just chat messages.

## Deferred Choices

- Postgres and multi-user RBAC.
- Hosted connector/cloud sync.
- Dynamic plugin marketplace.
- Full Excel/Google Docs parity.
- Heavy agent hierarchy/orchestration frameworks.

These are not rejected forever; they are deferred until local workflow
usage proves the need.
