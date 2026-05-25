# Roadmap

This roadmap summarizes direction. The execution source of truth is
[`docs/development-plan.md`](../development-plan.md).

## Now: implemented local foundation

- Core daemon: domain, store, parser, tools, Ollama loop, FastAPI.
- LibreOffice Calc extension with Review, Approve all, and Apply menu
  actions.
- Apply pipeline with immutable workbook versions, idempotence,
  conflict detection, and audit events.
- Trust modes: `direct`, `review`, and `locked`.
- MCP stdio server exposing the existing tool registry.
- Smarter workbook review: external refs, broken sheet refs, stale
  markers, named ranges, and dependencies.
- Native packaging scaffold and launcher.

## Next: prepare the codebase for the new direction

- Reconcile documentation around the local-first modular workspace
  direction.
- Introduce typed operation IR and map current proposal items onto it.
- Add explicit agent modes: inspect, plan, propose, apply, direct, locked.
- Add minimal run/session tracking so prompts, tool calls, proposals,
  decisions, apply, and audit can be traced together.
- Refactor the tool registry metadata around capability, resource kind,
  mode, and policy.
- Keep SQLite/local files as the default; no hosted services required.

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
