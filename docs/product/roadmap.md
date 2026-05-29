# Roadmap

This roadmap summarizes direction. The execution source of truth is
[`docs/development-plan.md`](../development-plan.md).

## Now: implemented core engine + provider-neutral contracts

- Core daemon: domain, store, parser, tools, Ollama loop, FastAPI,
  Gemini adapter, evals harness.
- Operation IR: typed operations, standalone `operations` table, lifecycle
  CRUD, HTTP API.
- Provider adapter contract: `ProviderAdapter` ABC, `ProviderCapabilities`,
  lazy provider registry.
- Google Sheets adapter (Sheets API v4, OAuth, mocked tests, registered).
- Local XLSX adapter wrapping existing parser/apply.
- Run/session tracing: `run_events` table, tool-call recording from `/chat`,
  event API.
- Resource model: `resources` table, `/api/resources/` aliased routes.
- Agent modes: inspect, plan, propose, apply, direct, locked (wired in
  `/chat` and `/api/tools`).
- LibreOffice Calc extension (Review, Approve all, Apply; sidebar pending).
- Apply pipeline with immutable versions, conflict detection, idempotence,
  audit events.
- Trust modes: `review`, `locked`, and opt-in `direct`.
- MCP stdio server.
- Validators: circular-ref and broken-sheet-ref pre-apply.
- Native packaging scaffold.

## Next: artifact-centered local beta

- Replace message-box review with artifact-centered Calc sidebar or
  local web UI surface.
- Show findings, proposed operations, validation status, dependency
  impact, and audit timeline.
- Add per-item approve/reject and clear trust-mode controls.
- Add explicit permission policy returning `allow`, `ask`, `deny`.
- Add local skills registry for repeatable workflows.
- Add config-file-based model selection.

## Near term: artifact-centered local beta

- Replace message-box review with an artifact-centered Calc sidebar or
  local UI surface.
- Show findings, proposed operations, validation status, dependency
  impact, and audit timeline.
- Add per-item approve/reject and clear trust-mode controls.
- Add local skills registry for repeatable workflows such as formula
  audit, month-end review, scenario analysis, and report generation.
- Add deterministic spreadsheet tools before relying on larger models.
- Add config-file based model selection while keeping Ollama default.

The UX contract is defined in [`ux-principles.md`](ux-principles.md).

## Next provider: Google Sheets

- Add provider capability model.
- Add Google Sheets adapter behind the same operation IR.
- Use user-supplied OAuth/API credentials during development.
- Avoid hosted connector infrastructure until local adapter value is
  proven.
- Start with read, inspect, propose, and apply for cell/range operations.

## Later providers and product surfaces

- Google Docs provider for text operations, suggestions, comments, and
  structured report workflows.
- Excel/Office adapter after spreadsheet operation IR stabilizes.
- Optional local web UI for users who do not want to live inside
  LibreOffice.
- Stronger model adapters: one cloud provider at a time, opt-in only.

## Post-beta

- Normalized proposal/operation/event storage beyond the minimum run
  indexes.
- Optional Postgres backend for shared-daemon deployments.
- Reviewer profiles, RBAC, team access, and notifications.
- Signed/notarized native installers.
- Dynamic plugin runtime or marketplace only after skills and static
  adapters prove insufficient.

## Non-goals

- Becoming a spreadsheet or document editor replacement.
- Cloud-only operation.
- Requiring paid APIs during development/testing.
- Building a generic agent platform before the spreadsheet/document
  workflow is excellent.
- Letting agents, skills, or MCP tools bypass operation policy.
