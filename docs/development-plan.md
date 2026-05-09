# SpreadbreadAI Development Plan

This document is the source of truth for what we are building, why, and in
what order. It supersedes the earlier `docs/architecture/implementation-plan.md`
and `docs/product/roadmap.md` for execution detail.

## Project summary

SpreadbreadAI is an open-source spreadsheet AI assistant for enterprise
and professional use. The product combines agentic LLM tool calling
with human-in-the-loop approval, immutable workbook versioning, and an
append-only audit trail. The LLM works through a fixed tool catalog
that separates read access from write-staging; the daemon owns every
state transition.

## Current shape (May 2026)

The implementation ships as a LibreOffice Calc plugin and a local
Python daemon. External AI clients (Claude Desktop, Cursor, VS Code,
Codex) drive the same tool catalog over MCP. Default model is Gemma 4
E2B via Ollama; the LLM adapter is pluggable.

An earlier Node + React prototype proved the domain model but lived
outside the spreadsheet. It has been retired; the LibreOffice plugin
plus local daemon is the canonical shape.

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
core/                   Python daemon (FastAPI + SQLite + Ollama)
  spreadbread_core/     domain, store, parser, tools, llm, apply, http, config
  tests/                pytest suites (unit + live LLM)
  pyproject.toml
extension/              LibreOffice .oxt extension (Python UNO)
  manifest/             META-INF, description, Addons.xcu, ProtocolHandler.xcu
  python/               UNO component + spreadbreadai package
  tests/                pytest unit tests
  build.sh              packages → .oxt
docs/                   product, architecture, ADRs, runbooks, this plan
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

### Phase 1 — Core Daemon (status: landed)

- Python package, Pydantic domain model, SQLite store.
- Parser via openpyxl (formula counts, sample rows, seeded risks).
- Tool registry with the v0.1 catalog.
- Ollama tool-calling loop.
- FastAPI HTTP daemon with healthz, upload, review, chat, decision.
- Unit + live integration tests.

### Phase 2 — LibreOffice Extension (status: scaffold landed; UI pending)

- (landed) Manifest scaffold (`META-INF/manifest.xml`, `description.xml`).
- (landed) Calc menu entry (`Addons.xcu`) and protocol handler (`ProtocolHandler.xcu`).
- (landed) Python UNO component — review action uploads the workbook,
  asks the local LLM to draft proposals, shows snapshot.
- (landed) `build.sh` packages `.oxt` cleanly (no `__pycache__`).
- (in progress) Real sidebar `.ui` panel with per-item approve / reject
  (replaces the v0.1 message-box UI).

### Phase 2.5 — End-to-end user-test affordances (status: landed)

- (landed) `POST /api/proposals/{id}/approve-all` flips all pending
  items to approved with a single reviewer name. Still HITL — an
  approver clicks the button.
- (landed) Three-step LibreOffice menu (Review → Approve all → Apply)
  so the full loop works without curl.
- (landed) Confirmation dialog with item preview before bulk approval.
- (landed) HTTP-level pytest coverage to guard against the
  FastAPI / Pydantic forward-ref body-resolution trap (`test_http.py`).

### Phase 3 — Apply Pipeline (status: landed)

- (landed) Daemon endpoint `POST /api/proposals/{id}/apply` produces a
  new workbook version (`.xlsx` bytes written to the data dir).
- (landed) Idempotent: a proposal in `applied` state returns its
  existing version.
- (landed) Guards: pending items block apply; zero approved items
  blocks apply.
- (landed) Audit events written: `proposal.applied` and
  `version.created`.
- (landed) Extension `spreadbread:apply` writes approved cells into the
  active Calc document via the Calc bridge, then asks the daemon to
  commit the canonical version.
- (in progress) Conflict detection when the active workbook diverges
  from the version the proposal was generated against.

### Phase 3.5 — Hardening (next, prioritized from peer review)

- **Conflict detection on apply.** Track `source_version_id` and a
  SHA-256 checksum of the base xlsx on the proposal at creation time.
  Refuse `apply` if the workbook's latest version no longer matches.
  Without this, applying a stale proposal silently overwrites the
  user's later edits.
- **Reorder extension apply.** Daemon commits the canonical version
  first; only on success does the extension write to the active Calc
  document as a UX courtesy. Daemon is the source of truth.
- **Dedupe cell-ref parsing.** Single shared module covers absolute
  refs (`$A$1`), ranges (`A1:B2`), and named ranges; fails loudly on
  unsupported inputs instead of producing garbage.

The default model stays `gemma4:e2b` deliberately. The smallest viable
local model keeps the install footprint and laptop-RAM bar low. Users
who want stronger cell reasoning can swap to Qwen 3 8B or a cloud
provider through the multi-LLM adapter (Phase 7) — but the default
will not change before the rest of the platform is fast and stable.

### Phase 4 — Trust modes (planned)

The current pipeline always stages every change for explicit approval.
That is correct as the *default for non-owners and for autonomous
agent runs*, but it is friction for the workbook owner who is actively
driving the LLM. Trust modes:

- `direct` (default for the workbook owner): the LLM applies tool
  results immediately. Audit trail and versioning still capture every
  change; the user can undo via the version history.
- `review` (default for non-owners and scheduled agent runs): the
  current Review → Approve → Apply pipeline.
- `locked` (per-workbook setting): explicit approval required even
  from owners. For compliance / regulated contexts.

Apply remains one code path; only the trigger differs. The HITL
guarantee is preserved through immutable versioning + audit, not
through a forced per-action click.

### Phase 5 — MCP server (status: landed)

For an AI-first product, MCP is not a "later" feature. Without it,
users' existing AI tools (Claude Desktop, Cursor, VS Code agents)
cannot drive SpreadbreadAI. With it, those tools become free
distribution channels.

- (landed) `spreadbread-mcp` stdio entry point exposing the existing
  tool registry. Same six tools, same registry, same approval
  pipeline — write tools stage items, apply requires approved items.
- (landed) External MCP invocations write a distinct
  `mcp.tool.<name>` audit event so traffic is traceable separately
  from the local-LLM loop.
- (in progress) Documented connection recipes for each major MCP
  client (Claude Desktop config landed in README; Cursor and VS Code
  to follow).

### Phase 6 — Smarter Review

- Formula dependency graph (cell → cell references).
- Stale-input detection (values not updated since last version).
- External reference drift detection.
- Named-range awareness in the parser and diffs.
- LLM gets richer context tools: `get_dependencies(cell)`,
  `find_similar_cells`.
- Replace the placeholder "X formula cells need review" risk with
  real signal — currently the risk system is a notification dressed
  as insight.

### Phase 7 — Multi-LLM adapter

The LLM layer is already isolated in `core/spreadbread_core/llm.py`
behind one client class. Generalize it into an `LLMAdapter` interface
with three concrete implementations:

- `OllamaAdapter` (current; covers Gemma 4, Qwen 2.5/3, Llama 3.3,
  Mistral Nemo).
- `GeminiAdapter` (Google function-calling API).
- `OpenAIAdapter` (covers gpt-4o / o-series; Anthropic later).

Provider selection lives in `~/.config/spreadbreadai/config.toml` with
the API key in a separate `credentials` file (`chmod 600`).

### Phase 8 — Real installer (status: scaffolded)

`scripts/install.sh` only installs the daemon and assumes the user is a
developer. A real installer ships a native bundle per OS so end users
download one file and run it.

- (landed) `packaging/` directory with a Briefcase project. Briefcase
  produces `.dmg` (macOS), `.msi` (Windows), and `.AppImage` (Linux)
  from a single Python codebase.
- (landed) `packaging/src/spreadbreadai_launcher/` is a tray app that
  supervises the daemon as a subprocess: starts it, restarts on crash,
  shuts it down on quit. End users never see a terminal.
- (landed) `bootstrap.py` runs first-time setup on each launch
  (idempotent): downloads + installs Ollama if absent, pulls
  `gemma4:e2b`, and registers the bundled `.oxt` with LibreOffice via
  `unopkg add`.
- (landed) `.github/workflows/release.yml` builds the native bundle on
  macOS, Windows, and Linux runners on every tag push and attaches the
  artifacts to the GitHub Release.
- (in progress) Real tray icon artwork (`resources/spreadbreadai.icns`,
  `.ico`, `.png`).
- (in progress) Code signing on Windows and notarization on macOS so
  Gatekeeper / SmartScreen don't warn the user.
- (planned) Homebrew formula in a tap repo for `brew install
  spreadbreadai` on macOS / Linux.

### Phase 9 — Schema normalization and concurrency

JSON-blob storage of full proposals in a `payload` column was fine for
the prototype but does not scale:

- Cannot query "pending proposals across all workbooks" without
  loading and deserializing every row.
- No referential integrity on proposal items (nested in JSON).
- No interlock against two clients editing the same proposal.

Migration:

- Promote `proposal_items` to its own table with indexed `status` and
  `proposal_id`.
- Add an optimistic-concurrency token (`updated_at` or a row version)
  on `proposals` and check it on every write.
- Postgres driver behind the same `Store` interface for shared-daemon
  deployments.

### Phase 10 — Test coverage gaps

Currently missing:

- Dedicated parser tests.
- Tests for `ToolRegistry._ensure_proposal` when the latest proposal
  is already applied (does the model start a new one?).
- Property-based tests for cell-reference parsing.
- Extension-side tests for sidebar dispatch and the upload flow.

### Phase 11 — Optional web review UI

- Small focused single-page app (deliberately not the 5k-line
  monolith of the original prototype).
- Hits the same daemon on `127.0.0.1:8765`.
- For users who want review without LibreOffice.

### Phase 12 — Multi-user and cloud sync (post-MVP)

- Optional shared-daemon deployment for small teams.
- Postgres driver (lands earlier in Phase 9 for normalization
  reasons; team mode reuses it).
- Reviewer profiles, RBAC, scoped access.
- Notification feed.

## Known issues, scheduled

The peer-review notes that drove Phases 3.5 / 4 / 5 / 7 / 8 / 9 / 10
also surfaced these specific issues — each is now tracked as part of
the phases above. Cross-reference for future contributors:

| Issue | Phase |
|---|---|
| No conflict detection on apply (data-loss risk) | 3.5 |
| Extension apply writes to Calc before committing canonical version | 3.5 |
| JSON-blob storage of proposals will not scale | 9 |
| Parser "risks" are placeholders, not insight | 6 |
| Duplicated, incomplete cell-reference parsing in apply.py and calc_bridge.py | 3.5 |
| 2.3B default model is the weakest link in cell reasoning | 3.5 |
| Config is ENV-only with a fragile path default that breaks pipx installs | 7/8 |
| No MCP server yet — users' AI tools cannot drive the daemon | 5 |
| Test coverage gaps in parser, `_ensure_proposal`, sidebar dispatch | 10 |
| No concurrency control beyond SQLite's default locking | 9 |

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
