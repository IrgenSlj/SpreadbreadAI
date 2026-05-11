# System Architecture

See [`docs/development-plan.md`](../development-plan.md) for the phased
plan. This document describes the steady-state shape.

## Top-level components

### LibreOffice extension (`extension/`)

A Python UNO extension installed as `spreadbreadai.oxt`.

Responsibilities:

- register Calc menu actions for Review, Approve all, and Apply
- show workbook risks and staged proposal items
- mirror approved cell diffs into the active sheet after daemon apply
- track the uploaded workbook id for the active Calc document
- talk to the local daemon over `127.0.0.1:8765`

The extension contains no business logic. Everything authoritative
lives in the daemon.

### Core daemon (`core/`)

A Python process serving FastAPI on `127.0.0.1:8765`, backed by SQLite.

Responsibilities:

- own the canonical state of every workbook, proposal, item, and audit
  event
- parse `.xlsx` uploads (openpyxl)
- expose the tool registry to the LLM
- run the LLM tool-calling loop (Ollama by default)
- enforce the default human-in-the-loop flow — write tools stage items;
  apply requires approved items only
- expose the same tool catalog over MCP stdio

### LLM adapter (`core/spreadbread_core/llm.py`)

Default: Ollama, model `gemma4:e2b`. The adapter speaks the OpenAI-style
tool-calling protocol Ollama exposes; cloud providers can be plugged in
behind the same interface.

The LLM never has direct workbook access. It uses tools.

### Optional review web UI (deferred)

A small SPA that hits the same daemon. Out of scope for the MVP but the
daemon API is shaped to support it without changes.

## Domain objects

These live in `core/spreadbread_core/domain.py`:

- `Workbook` — id, name, owner, sheets, risks, versions, tags, status
- `WorkbookSheet` — name, dimensions, formula counts, sample rows
- `WorkbookRisk` — id, label, severity, location, summary
- `WorkbookVersion` — id, created_at, created_by, note
- `Proposal` — id, workbook_id, status, items, applied_*
- `ProposalItem` — id, kind, cell, before, after, after_type, rationale, status
- `AuditEvent` — id, workbook_id, actor, action, detail, created_at
- `ReviewSnapshot` — Workbook + latest Proposal + audit list

## Storage

SQLite by default. Schema in `core/spreadbread_core/store.py`:

- `workbooks(id, name, owner, created_at, payload JSON)`
- `proposals(id, workbook_id, status, created_at, payload JSON)`
- `audit_events(id, workbook_id, actor, action, detail, created_at)`

Pydantic payloads are stored as JSON inside the row, with normalized
columns for query and indexing. Postgres is a future option behind the
same store interface.

## API surface

Local HTTP (FastAPI), `127.0.0.1:8765`:

- `GET  /healthz`
- `GET  /api/workbooks`
- `POST /api/workbooks/upload`
- `GET  /api/workbooks/{id}/review`
- `POST /api/workbooks/{id}/trust-mode`
- `POST /api/workbooks/{id}/chat`
- `POST /api/proposals/{proposal_id}/items/{item_id}/decision`
- `POST /api/proposals/{proposal_id}/approve-all`
- `POST /api/proposals/{proposal_id}/apply`
- `GET  /api/tools`

MCP stdio: `spreadbread-mcp`, mirrors the tool catalog.

## Design constraints

- The LLM cannot write directly to a workbook. Write tools stage; apply
  needs approved items. `direct` mode may auto-approve staged items,
  but still goes through daemon apply, versioning, and audit.
- Every state transition writes an audit event.
- Workbook versions are immutable; new versions are created, never
  edited.
- The platform is model-agnostic; the LLM is replaceable.
- Local-first; cloud is opt-in.
- Apply must be idempotent — a proposal is applied at most once.
- Request validation fails closed with explicit errors.

## What is not here

The native installer, multi-LLM adapter, normalized storage, and the
optional web review UI are documented in the development plan and
tracked there.
