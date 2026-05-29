# SpreadbreadAI Development Plan

Last updated: 2026-05-29.

This document is the source of truth for implementation sequencing.
The product is moving from a LibreOffice-only spreadsheet assistant
toward a local-first, modular agentic workspace for spreadsheet and
document work. The implementation must move from the specific to the
general: finish and harden the current local Calc loop first, then add
provider-neutral contracts, then expand to Google and other providers.

Supporting contracts:

- [`architecture/operation-ir.md`](architecture/operation-ir.md)
- [`architecture/skills-tools-and-policy.md`](architecture/skills-tools-and-policy.md)
- [`product/ux-principles.md`](product/ux-principles.md)

## Current Product Shape

SpreadbreadAI currently ships as:

- a local Python daemon using FastAPI, SQLite, openpyxl, Ollama, and MCP
- a LibreOffice Calc extension that uploads workbooks, requests review,
  approves staged proposal items, and applies approved diffs
- a tool registry with read tools and write-staging tools
- an apply pipeline with conflict detection, immutable workbook
  versions, idempotence, and audit events
- trust modes: `review`, `locked`, and opt-in `direct`

This is the first provider implementation. It should not be discarded.
It is the proving ground for the provider-neutral engine.

## Product Direction

The target product is:

**a local-first agentic workspace for complex spreadsheet and document
work, with provider adapters, typed operations, skills, MCP
integrations, and auditable apply.**

The UX principle is:

**conversation-led, artifact-centered, policy-gated.**

- Chat or command prompts start work.
- Findings, proposed operations, diffs, validation results, dependency
  impact, and audit events hold the work.
- Policy decides whether an operation is read-only, staged, blocked,
  review-required, or eligible for bounded auto-apply.

## Non-Negotiables

- Local-first and low-cost by default.
- No hosted service, paid API, Postgres server, vector database, or
  plugin marketplace may become required during development/beta.
- SQLite/local files remain the default store.
- Ollama/local models remain the default model path.
- Cloud LLMs and Google/Office connectors are opt-in and use
  user-supplied credentials during development.
- Agents, skills, MCP tools, and provider adapters cannot bypass the
  operation policy or apply pipeline.
- The daemon is the source of truth for state, policy, versioning, and audit.

## Architecture Direction

```text
User surfaces
  LibreOffice sidebar
  Local artifact UI
  MCP clients
  Future Google/Office surfaces

Local gateway / daemon
  sessions and run queue
  agent modes
  tool registry
  permission policy
  skill loader
  MCP bridge
  audit/event stream

Document engine
  spreadsheet model
  text document model
  typed operation IR
  validators
  dependency/risk analyzers
  apply pipeline

Provider adapters
  LibreOffice/local xlsx
  Google Sheets
  Google Docs
  Excel/Office later

Storage
  SQLite by default
  local workbook/version bytes
  normalized runs/events/operations where needed
  Postgres only as a later optional backend
```

## Core Contracts To Add

### Operation IR

The current `ProposalItem` model is spreadsheet-specific. The next
contract is a typed operation IR that can represent spreadsheet and
document actions before provider mutation.

Initial operation kinds:

- `set_cell_value`
- `set_cell_formula`
- `add_cell_comment`
- `clear_cell`
- `replace_range_values`
- `create_sheet`
- `rename_sheet`
- `add_document_comment`
- `replace_document_text`
- `insert_document_section`

Each operation carries:

- resource id and provider
- target address or document range
- before/after data where available
- rationale
- risk level
- required capability
- validation status
- source run id
- approval status

### Provider Capability Model

Every provider adapter declares capabilities before tools can use it:

- resource kinds: spreadsheet, text document, presentation, file
- read capabilities
- write capabilities
- comment/suggestion support
- version/revision support
- conflict-detection support
- batch apply support
- offline/online requirement

The engine chooses tools and apply paths from declared capabilities, not
from provider-specific assumptions.

### Agent Modes

- `inspect` — read-only findings.
- `plan` — read-only plan and impact estimate.
- `propose` — creates operations/proposal items, no provider writes.
- `apply` — commits approved/trusted operations through provider adapter.
- `direct` — opt-in bounded auto-apply through the same apply pipeline.
- `locked` — strict write policy requiring per-item approval.

### Skills

Skills are workflow packs, preferably markdown/config first:

- formula audit
- month-end close review
- scenario modeling
- stale input cleanup
- report generation
- external reference repair

Skills teach the agent how to work. They do not get hidden write
permissions. Any skill-triggered operation still goes through policy,
validation, apply, and audit.

## Current Status Checklist

Landed:

- Core daemon, parser, store, tools, FastAPI API.
- Ollama tool-calling loop with local model default.
- Gemini adapter as first cloud LLM (opt-in, mocked in tests).
- LibreOffice extension v0.1 with menu actions.
- Apply pipeline with conflict detection, base checksum guard,
  idempotence, and audit events.
- Trust modes in the daemon.
- MCP stdio server.
- Risk detection for external refs, broken sheet refs, stale markers,
  named ranges, and dependencies.
- Packaging scaffold with native bundle direction.
- Operation IR: standalone operations table, CRUD, lifecycle transitions,
  validation, and HTTP API; ProposalItem operations synced on decision.
- Provider adapter contract: `ProviderAdapter` ABC, `ProviderCapabilities`,
  lazy provider registry with `get_provider()` / `register_provider()`.
- `LocalXlsxAdapter` wrapping existing parser/apply; `GoogleSheetsAdapter`
  via Sheets API v4 (read + write, OAuth, mocked tests).
- Validators: circular-ref and broken-sheet-ref pre-apply validation.
- Eval harness: 4 synthetic workbooks, 7 cases, offline + LLM-gated.
- Agent run/session tracing: `run_events` table, tool-call recording
  from `/chat`, event endpoints, counter fields on `AgentRun`.
- `Resource` model, resources table, `/api/resources/` aliased routes.
- Artifact API (`GET /api/runs/{id}/artifacts`) with structured findings,
  operations, timeline, and dependency impact.
- Prototype web UI (`/ui/`) with chat, artifact viewer, per-item
  approve/reject, approve-all, apply, create/delete workbook, mode
  selector, trust mode, and dark mode.

Known gaps:

- Message-box UI is not sufficient for artifact-centered workflows.
- Proposal items now carry provider-neutral operation metadata, but
  storage and public review APIs are still proposal-first.
- Tool permissions have an initial explicit policy/filtering layer;
  UI prompts, user rules, and resource scoping are still pending.
- Agent modes now exist at the `/chat`, LLM schema-filtering, and
  `/api/tools` boundary; UI affordances and richer per-run artifacts
  are still pending.
- No local skills registry.
- No fully normalized queryable run spine — `run_events` table exists
  and events are wired; further normalization can wait.
- Google Sheets adapter is wired into the provider registry but has
  no end-to-end integration test without real credentials.

## Sprint Status

| Sprint | Status |
|---|---|
| Sprint 0 — Documentation And Baseline | Complete |
| Sprint 1 — Local Loop / Sidebar UI | Partial (sidebar not started) |
| Sprint 2 — Operation IR | Complete |
| Sprint 3 — Runs, Events, And Policy | Partial (run_events done; policy/permission metadata pending) |
| Sprint 4 — Agent Modes And Workspace Spine | Partial (modes exist in chat/tools API; resource model added) |
| Sprint 5 — Artifact-Centered UI | Partial (artifact models, API, and prototype UI built; redesign pending) |
| Sprint 6 — Skills And MCP Hardening | Not started |
| Sprint 7 — Google Sheets Adapter | Partial (adapter created, registered, tested with mocks; no end-to-end) |
| Sprint 8 — Model Adapter And Cost Controls | Partial (LLM package created; Gemini adapter done; cost hooks pending) |
| Sprint 9 — Beta Hardening | Not started |
| Sprint 10 — Later Scale Work | Not started |

### Sprint 0: Documentation And Baseline

Goal: make the repo point in one direction and record the current green
baseline before structural work.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 0.1 | Reconcile docs around local-first modular workspace direction. | README, PRD, roadmap, architecture, ADR, setup, handoff, templates, and component READMEs no longer contradict landed status or the new direction. |
| 0.2 | Run baseline verification. | Core tests, extension tests, ruff, `.oxt` build, and daemon health check are recorded. Live Ollama test may skip if unavailable. |
| 0.3 | Add a small architecture glossary if terms drift. | Operation, resource, provider, skill, tool, run, proposal, and artifact are defined consistently. |

### Sprint 1: Finish The Existing Local Loop

Goal: improve the current LibreOffice/local xlsx experience without
inventing the broader platform yet.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 1.1 | Replace message-box review with a sidebar/artifact skeleton. | Calc review populates findings, proposal items, and audit summary in a sidebar; extension remains a thin daemon client. |
| 1.2 | Add per-item approve/reject UI. | Individual decisions call daemon APIs; audit records reviewer and decision; locked mode blocks bulk approval. |
| 1.3 | Add visible trust/mode controls. | User can see and change `review`, `locked`, and `direct`; direct mode is clearly opt-in and auditable. |
| 1.4 | Add extension tests around state and dispatch. | Upload/review, proposal rendering state, approve/reject dispatch, apply success, and apply failure display are covered without requiring LibreOffice UI automation. |

### Sprint 2: Operation IR (Complete)

Introduced typed operations while preserving the existing proposal/apply behavior.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 2.1 | Add `Operation` domain types for spreadsheet cell/comment operations. | Existing `ProposalItem` can be converted to/from operation objects without behavior changes. |
| 2.2 | Add operation validation status and risk level. | Invalid addresses, unsupported kinds, stale base versions, and provider capability mismatches fail closed. |
| 2.3 | Store operation metadata in proposals. | Existing APIs remain backward-compatible; review payloads include operation data for new clients. |
| 2.4 | Update apply to execute operation batches internally. | Current cell diff/comment apply still passes all tests; idempotence and conflict checks remain intact. |

### Sprint 3: Runs, Events, And Policy

Goal: make agent work traceable and permissioned as a product feature.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 3.1 | Add `AgentRun` or equivalent run id. | One chat/review run links prompt, tool calls, proposal items, decisions, apply, and audit events. |
| 3.2 | Add a small event/tool-call table or normalized audit index. | UI can query a run timeline without deserializing every proposal blob. |
| 3.3 | Introduce explicit permission policy: `allow`, `ask`, `deny`. | Tool availability and execution are filtered by mode, trust policy, provider capability, and resource. |
| 3.4 | Convert tool registry metadata to include resource kind, capability, mode, and risk. | Ollama and MCP still expose the same usable tools; tests prove no tool can write directly. |

### Sprint 4: Agent Modes And Workspace Spine

Goal: make modes and resources first-class without building a generic
platform.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 4.1 | Add a default local workspace. | Existing workbooks belong to one default workspace; current APIs keep working. |
| 4.2 | Add `Resource`/`ResourceKind`. | Workbook resources can be listed generically; no provider rewrite required. |
| 4.3 | Add mode-aware chat/review entry points. | `inspect`, `plan`, `propose`, and `apply` produce predictable tool access and response shape. |
| 4.4 | Expose workspace/resource discovery over HTTP and MCP. | External agents can discover resources without hard-coded workbook assumptions. |

### Sprint 5: Artifact-Centered UI

Goal: make the UX reflect the product: artifacts first, chat as entry.

| Session | Scope | Acceptance Criteria |
|---|---|---|---|
| 5.1 | Define artifact response models. (done) | Findings, operations, validation results, dependency impact, and audit events have stable API shapes. |
| 5.2 | Build local artifact UI surface. (done — prototype; redesign pending) | User can start a run, inspect artifacts, approve/reject operations, apply, and view timeline locally. |
| 5.3 | Add cost/status indicators. | UI shows model/provider, local/cloud status, trust mode, and whether paid services are in use. |
| 5.4 | Add exportable run summary. | One run can be summarized as a report with prompt, tools, operations, decisions, versions, and audit. |

### Sprint 6: Skills And MCP Hardening

Goal: add repeatable workflows without a plugin marketplace or hidden
permissions.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 6.1 | Add local skills directory and loader. | `skills/<name>/SKILL.md` files can be discovered, listed, and selectively loaded. |
| 6.2 | Add skill metadata and allowlists. | Skills declare resource kind, required tools, provider requirements, risk level, and optional env/binary requirements. |
| 6.3 | Route skill execution through agent modes and policy. | Skill-triggered operations are validated, permission-gated, and audited. |
| 6.4 | Harden MCP tool exposure. | MCP tools are filtered by the same mode/policy/capability rules as local agent tools. |

### Sprint 7: Google Sheets Adapter

Goal: add the first non-LibreOffice provider after operation IR and
policy are stable.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 7.1 | Add provider adapter interface and capability declarations. | LibreOffice/local xlsx path implements the interface without behavior regression. |
| 7.2 | Add Google Sheets read adapter with local/user-supplied credentials. | One spreadsheet can be inspected and converted into the shared resource/document model. |
| 7.3 | Add Google Sheets propose/apply for basic cell/range operations. | Operations use Sheets API batch semantics, conflict checks where possible, and audit. |
| 7.4 | Add provider-specific tests with mocked Google API. | No test requires paid services or real user data. |

### Sprint 8: Model Adapter And Cost Controls

Goal: support stronger models without making paid APIs required.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 8.1 | Introduce `LLMAdapter` interface around current Ollama client. | Ollama remains default; existing live/local tests still pass or skip cleanly. |
| 8.2 | Add config file support separate from credentials. | Model/provider selection lives in user config; secrets are not stored in repo or logs. |
| 8.3 | Add one optional cloud adapter only. | Adapter has mocked contract tests; failure degrades cleanly; no cloud key required for default tests. |
| 8.4 | Add usage/cost display hooks. | Runs record local/cloud provider, model, token/usage data when available, and cost estimate when applicable. |

### Sprint 9: Beta Hardening

Goal: make the local beta boring to install, test, and demo.

| Session | Scope | Acceptance Criteria |
|---|---|---|
| 9.1 | Harden launcher and daemon supervision. | Fresh local install starts daemon, pulls/fetches local model when allowed, registers extension, and recovers from daemon crash. |
| 9.2 | Add MCP client recipes. | Claude Desktop, Cursor, VS Code/Codex recipes can connect and list tools/resources. |
| 9.3 | Add internal beta script. | One FP&A workbook, one local review, one MCP-driven review, one apply, and one reset path run offline. |
| 9.4 | Fix documentation and onboarding gaps found during beta. | A new user can complete the demo without handholding. |

### Sprint 10: Later Scale Work

Do not start this until repeated local/beta usage proves the need.

| Scope | Trigger |
|---|---|
| Normalize proposal items/operations fully. | Query volume or UI needs exceed the minimum run/event indexes. |
| Optional Postgres backend. | Real shared-daemon/team usage appears. |
| Reviewer profiles/RBAC. | More than one human role participates in approvals. |
| Google Docs/Excel providers. | Google Sheets adapter validates the provider model. |
| Dynamic plugin runtime. | Markdown skills and static adapters are insufficient. |
| Hosted connector/cloud sync. | Users explicitly need cross-device/team collaboration. |

## Test Strategy

- Core unit tests for domain, parser, tools, policy, operations, store,
  apply, HTTP, and MCP.
- Extension tests for client/state/dispatch without depending on full
  LibreOffice UI automation.
- Provider adapter contract tests with mocks for network providers.
- Live LLM tests skip cleanly when Ollama is not reachable.
- No default CI path requires paid API credentials.

## Cost Controls

- Default path: local model + SQLite + local files.
- Google/Office work starts with local developer credentials and mocked tests.
- Cloud LLM adapters are opt-in and tested with mocks by default.
- Avoid hosted queues, vector DBs, multi-tenant auth, and managed
  databases until usage proves need.
- Use MCP clients as distribution rather than building integrations for
  every AI tool separately.

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| The project becomes a generic agent platform rewrite. | Start with Calc/local loop; add only operation IR, runs, policy, skills, and provider contracts needed by real workflows. |
| Sidebar/UI work consumes too much time. | Keep extension dumb; use daemon APIs and test UI state outside LibreOffice where possible. |
| Local model quality is weak. | Add deterministic spreadsheet tools and validators before larger models; require approval for risky operations. |
| Google integration creates cost/security drag. | Make it opt-in, local-credential based, and mocked in tests. |
| SQLite JSON blobs become limiting. | Normalize run/event/operation indexes incrementally; postpone full store rewrite. |
| Direct mode bypasses user trust. | Keep direct opt-in, bounded, validated, versioned, and audited. |

## Definition Of Ready For Broader Beta

- Calc and MCP both drive the same daemon-owned workflow.
- Operations are typed and policy-gated.
- Agent modes are visible in APIs and UI.
- Runs are traceable from prompt to tools, proposals, decisions, apply,
  versions, and audit.
- Artifact UI shows findings, operations, validation, and timeline.
- Default install works offline with Ollama and SQLite.
- No required paid API or hosted service exists in the happy path.
