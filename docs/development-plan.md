# SpreadbreadAI Development Plan

This document is the source of truth for what we are building, why, and in
what order. It supersedes the earlier `docs/architecture/implementation-plan.md`
and `docs/product/roadmap.md` for execution detail.

## Mission

SpreadbreadAI is an open-source, human-in-the-loop spreadsheet operations
platform. The product is **not** a generic chat-with-spreadsheet bot. It is
a governed control plane where AI inspects workbooks, drafts proposals,
and explains its reasoning — while humans review diffs and approve every
write.

## Strategic Pivot (2026-05)

The original prototype was a Node + React web app with an MCP server.
That prototype proved the domain model but missed the place where finance
users actually live: inside their spreadsheet. The product is being
rebuilt as a **LibreOffice Calc plugin** backed by a small **local Python
daemon** that runs **free local LLMs** by default (Gemma 4 E2B via
Ollama).

The legacy Node + React code is preserved under `legacy/` for reference
and is no longer the supported runtime.

## Target Architecture

```
┌─ LibreOffice Calc ────────────────────────────────┐
│  ┌─ Sidebar (Python UNO extension, .oxt) ───────┐ │
│  │  Proposals · Diffs · Risks · Audit · Approve │ │
│  └────────────────┬─────────────────────────────┘ │
└───────────────────┼───────────────────────────────┘
                    │ localhost JSON over HTTP (8765)
┌───────────────────▼───────────────────────────────┐
│  Core daemon (Python, FastAPI, SQLite)            │
│  · workbook parsing (openpyxl)                    │
│  · proposal state machine                         │
│  · diff / apply engine                            │
│  · audit log                                      │
│  · tool registry exposed to the LLM               │
│  · MCP server (later)                             │
└───────────────────┬───────────────────────────────┘
                    │ pluggable LLM adapter
        ┌───────────┴───────────┐
        ▼                       ▼
   Ollama (local)         Cloud (optional)
   Gemma 4 E2B (default)  Claude / GPT / Gemini
   Qwen 2.5 / Llama 3.3   via API key
```

### Component responsibilities

- **LibreOffice extension** (`extension/`) — sidebar UI, "Open in
  SpreadbreadAI" command, diff renderer, approve/reject actions, write
  approved diffs back to the active workbook. No business logic.
- **Core daemon** (`core/`) — single Python process, single SQLite file,
  owns every domain object and every state transition. Exposes a
  localhost HTTP API and an MCP stdio server.
- **LLM adapter** (`core/spreadbread_core/llm.py`) — Ollama-first
  tool-calling loop. Pluggable so cloud models can be swapped in.
- **Web review UI** (deferred) — a small optional review surface for
  users who do not run LibreOffice. Will reuse the same daemon.

### Repository layout

```text
core/                   Python daemon (current home of the rewrite)
  spreadbread_core/     domain, store, parser, tools, llm, http, config
  tests/                pytest suites (unit + live LLM)
  pyproject.toml
extension/              LibreOffice .oxt extension (Python UNO)
  manifest/             META-INF, Description.xml, Addons.xcu, Sidebar.xcu
  python/               UNO component code
  build.sh              packages → .oxt
docs/                   product, architecture, ADRs, runbooks, this plan
legacy/                 frozen Node + React prototype (reference only)
```

## How the LLM Does Work

The platform talks to Gemma 4 E2B through Ollama's tool-calling API.
The daemon publishes a fixed catalog of tools — read tools have no side
effects; write tools only stage proposal items for human approval and
**cannot mutate workbooks directly**. This is the governance contract.

Tool catalog (v0.1):

- `list_workbooks` — read
- `get_review_snapshot(workbook_id)` — read
- `inspect_sheet(workbook_id, sheet_name)` — read
- `list_risks(workbook_id)` — read
- `propose_diff(workbook_id, cell, kind, before?, after?, rationale)` — stages a pending item
- `add_comment(workbook_id, cell, body)` — stages a pending comment item

Loop:

1. User asks the daemon to review a workbook.
2. Daemon sends Gemma 4 the tool catalog and the request.
3. Model emits tool calls; daemon executes and feeds results back.
4. Model produces a final summary; daemon returns it with the trace.
5. Approver flips items to `approved` or `rejected` via the daemon API;
   only then can the apply flow write a new workbook version.

## Phased Plan

### Phase 1 — Core Daemon (status: ✅ landed)

- Python package, Pydantic domain model, SQLite store.
- Parser via openpyxl (formula counts, sample rows, seeded risks).
- Tool registry with the v0.1 catalog.
- Ollama tool-calling loop (default `gemma4:e2b`).
- FastAPI HTTP daemon with healthz, upload, review, chat, decision.
- Unit + live integration tests.

### Phase 2 — LibreOffice Extension (status: ✅ scaffold landed; UI pending)

- ✅ Manifest scaffold (`META-INF/manifest.xml`, `description.xml`).
- ✅ Calc menu entry (`Addons.xcu`) and protocol handler (`ProtocolHandler.xcu`).
- ✅ Python UNO component — review action uploads workbook, asks Gemma 4
  to draft proposals, shows snapshot.
- ✅ `build.sh` packages `.oxt` cleanly (no `__pycache__`).
- 🚧 Real sidebar `.ui` panel with per-item approve / reject (replaces
  the v0.1 message-box UI).

### Phase 3 — Apply Pipeline (status: ✅ landed)

- ✅ Daemon endpoint `POST /api/proposals/{id}/apply` produces a new
  workbook version (`.xlsx` bytes written to the data dir).
- ✅ Idempotent: a proposal in `applied` state returns its existing
  version.
- ✅ Guards: pending items block apply; zero approved items blocks
  apply.
- ✅ Audit events written: `proposal.applied` + `version.created`.
- ✅ Extension `spreadbread:apply` writes approved cells into the
  active Calc document via the Calc bridge, then asks the daemon to
  commit the canonical version.
- 🚧 Conflict detection when the active workbook diverges from the
  version the proposal was generated against.

### Phase 4 — Smarter Review

- Formula dependency graph (cell → cell references).
- Stale-input detection (values not updated since last version).
- External reference drift detection.
- Named-range awareness in the parser and diffs.
- LLM gets richer context tools: `get_dependencies(cell)`, `find_similar_cells`.

### Phase 5 — Packaging & Distribution

- `pipx install spreadbread-core` for the daemon.
- `spreadbreadai.oxt` published on the LibreOffice extension marketplace
  and as a GitHub release asset.
- One-line installer that pulls Ollama + Gemma 4 E2B if missing.
- Signed releases.

### Phase 6 — MCP and Agent Clients

- Daemon exposes the same tool catalog over MCP stdio.
- Claude Code, Codex, and other MCP clients can connect.
- Tool calls from external clients go through the same approval pipeline.

### Phase 7 — Optional Web Review UI

- Small focused single-page app (deliberately not the 5k-line monolith).
- Hits the same daemon on `127.0.0.1:8765`.
- For users who want review without LibreOffice.

### Phase 8 — Multi-User & Cloud Sync (post-MVP)

- Optional shared-daemon deployment for small teams.
- Postgres driver behind the same store interface.
- Reviewer profiles, RBAC, scoped access (port from legacy).
- Notification feed.

## Non-Goals (for the MVP)

- Excel add-in. Calc first; Excel parity comes after the Calc loop is
  loved.
- Full formula recalculation engine. The daemon reads formulas; it does
  not evaluate them. LibreOffice / Excel evaluate.
- A custom DSL or query language.
- Cloud-only. The platform must work fully offline with local LLMs.

## Decisions and Why

- **Python over Rust for the core.** The LO extension is Python-native;
  one language ships faster. A Rust rewrite is on the table once the
  product shape is proven and the hot paths are visible.
- **SQLite over Postgres by default.** Single-user plugin; one file is
  the right footprint. Postgres becomes optional behind the same store
  interface.
- **Gemma 4 E2B as default model.** Smallest in the Gemma 4 family
  (~2.3B effective params, 4 GB RAM), released April 2026, supports
  tool calls via Ollama. Users can swap to Qwen 2.5, Llama 3.3, or a
  cloud model with one settings change.
- **Daemon, not embedded.** Keeps the extension thin, lets us reuse the
  daemon from a future web UI / VS Code addin / Excel addin without a
  second backend.
- **Human-in-the-loop is non-negotiable.** No tool path can mutate a
  workbook without a human approval. This is enforced in the registry,
  not in the prompt.

## Risks and Mitigations

- **Python UNO is poorly documented.** Mitigation: keep the extension
  dumb; everything interesting lives in the daemon.
- **Local 2B-class models hallucinate cell references.** Mitigation:
  every model action is staged for human review; the daemon validates
  that proposed cells exist before staging an item.
- **Distribution doubles the surface (.oxt, pipx, Ollama, model
  downloads).** Mitigation: a single bootstrap command and clear docs.
- **Excel parity will be requested immediately.** Mitigation: the
  daemon is workbook-format-agnostic from day one; the LO sidebar is
  the only LO-specific component.

## Validation Plan

- **Daemon:** pytest suites in `core/tests/`, including a live test
  that requires Ollama to be running.
- **Extension:** unit tests for the daemon client; manual install +
  smoke test inside LibreOffice Calc per release.
- **End-to-end demo (the bar for MVP):**
  1. Install the extension and run `spreadbread-core`.
  2. Open an FP&A workbook in Calc.
  3. Click "Review with SpreadbreadAI" — sidebar shows risks and
     three staged proposals from Gemma 4.
  4. Approve one diff.
  5. Click "Apply approved" — Calc cell updates; daemon writes the new
     version; audit trail shows every step.
- All of the above must work fully offline.
