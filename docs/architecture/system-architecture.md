# System Architecture

See [`docs/development-plan.md`](../development-plan.md) for sprint
sequencing. This document describes the target architecture and how the
current implementation evolves without a rewrite.

## Architecture Summary

SpreadbreadAI is a local-first modular monolith. A single local daemon
owns state, policy, agent runs, tools, operation validation, apply, and
audit. Provider-specific surfaces stay thin.

```text
User surfaces
  LibreOffice extension
  Local artifact UI
  MCP clients
  Future Google/Office entry points
        |
        v
Local daemon / gateway
  HTTP API
  MCP stdio
  run queue
  agent modes
  permission policy
  tool registry
  skill loader
  event stream
        |
        v
Document engine
  spreadsheet/text models
  risk analyzers
  operation IR
  validators
  proposal/apply pipeline
        |
        v
Provider adapters
  LibreOffice/local xlsx
  Google Sheets
  Google Docs
  Excel/Office later
```

## Current Provider: LibreOffice / Local XLSX

The current LibreOffice extension is the first provider-specific shell.

Responsibilities:

- register Calc actions for review, approval, trust/mode controls, and apply
- show artifacts returned by the daemon
- mirror applied changes into the active Calc document after daemon apply
- upload/open workbook resources
- talk to the daemon on `127.0.0.1:8765`

Non-responsibilities:

- no business logic
- no policy enforcement
- no independent versioning
- no direct model/tool writes

## Local Daemon

The daemon is a Python process serving FastAPI on `127.0.0.1:8765`,
backed by SQLite by default.

Responsibilities:

- own canonical state for workspaces, resources, runs, proposals,
  operations, versions, and audit events
- parse local `.xlsx` uploads
- expose HTTP and MCP surfaces
- run model/tool loops through explicit modes
- load skills and tools under policy
- validate proposed operations
- route apply through provider adapters
- emit audit and event timeline data

The daemon is intentionally not split into microservices during
development. SQLite, local files, and one process are the right default
until there is real multi-user demand.

## Agent Runtime

The runtime coordinates one agent run at a time per resource/session.

Core concepts:

- `AgentRun` — prompt, mode, model/provider, resource, tool calls,
  produced artifacts, and outcome.
- `Mode` — inspect, plan, propose, apply, direct, locked.
- `ToolRegistry` — declared tool schemas plus metadata for resource
  kind, capability, risk, and allowed modes.
- `PermissionPolicy` — evaluates `allow`, `ask`, or `deny` for a tool,
  operation, skill, or MCP call.
- `SkillLoader` — discovers local workflow packs and exposes only the
  relevant instructions/tools.

## Document Engine

The document engine converts provider data into shared internal models.

Spreadsheet model responsibilities:

- sheet metadata
- formulas and dependencies
- named ranges
- stale input markers
- external references
- broken sheet references
- proposed cell/range/comment operations

Text document model responsibilities, planned:

- sections/headings
- comments/suggestions
- replace/insert operations
- source/citation metadata
- report generation artifacts

## Operation IR

Provider mutation is represented as typed operations before apply.

Required operation fields:

- operation id
- resource id
- provider id
- kind
- target address/range
- before/after payload where available
- rationale
- risk level
- required capability
- validation status
- source run id
- approval status

Initial spreadsheet operations:

- `set_cell_value`
- `set_cell_formula`
- `add_cell_comment`
- `clear_cell`
- `replace_range_values`
- `create_sheet`
- `rename_sheet`

Initial text document operations:

- `add_document_comment`
- `replace_document_text`
- `insert_document_section`

Existing `ProposalItem` records remain supported while operations are
introduced. The migration path is additive: proposal items can carry
operation metadata, then apply can execute operation batches internally.

## Provider Adapter Contract

Each provider adapter declares capabilities and implements only those
operations.

Capability examples:

- `spreadsheet.read`
- `spreadsheet.write_cell`
- `spreadsheet.write_formula`
- `spreadsheet.comment`
- `spreadsheet.batch_update`
- `document.read`
- `document.suggest`
- `document.replace_text`
- `version.snapshot`
- `revision.detect_conflict`

Adapters planned:

- `local_xlsx` / LibreOffice-backed local files
- `google_sheets`
- `google_docs`
- `excel_office`

The engine must not assume that all providers support the same actions.
Unsupported operations fail closed before the model sees or executes a
tool that depends on them.

## Skills

Skills are local workflow packs, preferably markdown/config first.

Examples:

- formula audit
- month-end close review
- scenario modeling
- stale input cleanup
- external reference repair
- report generation

Skills are not a security boundary and do not grant hidden powers. They
can influence prompts and tool choice, but every tool call and operation
still goes through policy, validation, apply, and audit.

## Storage

Current SQLite tables:

- `workbooks` — workbook metadata + serialized payload
- `proposals` — proposal with items, decisions, and applied version link
- `audit_events` — immutably ordered state transitions
- `agent_runs` — per-chat run metadata (counters, summary)
- `resources` — generic resource metadata (provider_id, resource_kind, external_id)
- `operations` — standalone operation IR with lifecycle transitions
- `run_events` — per-run event timeline (tool calls, decisions, apply events)

Near-term additive tables/indexes:

- `artifacts` — findings, validation results, generated reports
- `workspaces` — logical grouping of resources

SQLite remains the default. Postgres is optional later for shared
daemon/team deployments, behind the same store interface.

## API Surface

Current HTTP API:

- `GET  /healthz`
- `GET  /api/workbooks`
- `POST /api/workbooks/upload`
- `GET  /api/workbooks/{id}/review`
- `GET  /api/workbooks/{id}/runs`
- `POST /api/workbooks/{id}/trust-mode`
- `POST /api/workbooks/{id}/chat`
- `GET  /api/runs/{run_id}`
- `GET  /api/runs/{run_id}/events`
- `GET  /api/workbooks/{id}/runs`
- `POST /api/proposals/{proposal_id}/items/{item_id}/decision`
- `POST /api/proposals/{proposal_id}/approve-all`
- `POST /api/proposals/{proposal_id}/apply`
- `GET  /api/tools`
- `GET  /api/resources` — list resources
- `GET  /api/operations` — list/filter operations
- `GET  /api/operations/{id}` — single operation
- `POST /api/operations/validate` — validate an operation
- `POST /api/operations/{id}/transition` — lifecycle transition
- `POST /api/decisions/item` — decide a single proposal item (syncs operation)
- `POST /api/decisions/approve-all` — approve all pending items for a proposal
- All workbooks routes also accept `/api/resources/{resource_id}` aliases

`/chat` accepts an optional `mode` field. Default is `propose` to
preserve the current review flow. `/api/tools?mode=inspect` and other
mode-filtered requests expose only tools allowed by the policy layer.
Each `/chat` call creates an `AgentRun`, returns `run_id`, records tool
calls as `run_events`, and writes audit events.

Planned additive API:

- artifact listing and export
- skill listing and invocation
- provider connection status
- workspace management

MCP stdio: `spreadbread-mcp`, filtered through the same policy layer.

## UI Architecture

The target UX is not chat-only and not review-only.

Primary surfaces:

- composer for chat/commands
- artifact board for findings, operations, validation, impact, and outputs
- diff/review panel for risky operations
- timeline for tool calls, decisions, apply, and audit
- provider/status bar showing local/cloud model, trust mode, and cost state

LibreOffice may host this as a sidebar. A local web UI may host the same
daemon data later.

## Security And Policy Constraints

- Agents, skills, and MCP clients do not receive direct provider write
  channels.
- Write-capable tools stage operations first.
- Apply commits approved or explicitly trusted operations only.
- Every state transition emits an audit event.
- Direct/autopilot behavior is opt-in, bounded, validated, versioned,
  and audited.
- Request validation fails closed.
- Localhost API assumes a single local user; do not bind to the network
  without auth.

## What Is Intentionally Not Here Yet

- multi-tenant cloud service
- hosted queues
- vector database requirement
- Postgres requirement
- dynamic plugin marketplace
- broad Google/Office provider matrix
- manager-of-agents orchestration framework
