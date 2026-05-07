# SpreadbreadAI Agent Handoff

## Mission

SpreadbreadAI is an open-source, human-in-the-loop spreadsheet operations
platform. The product is a governed control plane where AI inspects
workbooks, drafts proposals, and humans review and approve every write.

The current focus is **LibreOffice Calc as the primary surface** with a
**local Python daemon** running **free local LLMs** (Gemma 4 E2B by
default via Ollama).

Read [`docs/development-plan.md`](docs/development-plan.md) before
starting work — it is the source of truth for phases, decisions, and the
target architecture.

## Repository Layout

```text
core/                   Python daemon (FastAPI + SQLite + Ollama)
  spreadbread_core/
    domain.py           Pydantic models — Workbook, Proposal, Item, Audit
    store.py            SQLite repository
    parser.py           openpyxl-based .xlsx parser
    tools.py            tool registry exposed to the LLM
    llm.py              Ollama tool-calling loop
    http.py             FastAPI app + uvicorn entry
    config.py
  tests/                pytest suites (unit + live LLM)
  pyproject.toml
extension/              LibreOffice .oxt plugin (Python UNO) — in progress
docs/                   product, architecture, ADRs, runbooks, plan
legacy/                 frozen Node + React prototype (reference only)
```

## What Exists Today

### Core daemon (`core/`)

- **Domain model** in Pydantic, ported from the legacy TypeScript types.
- **SQLite store** — single backend, no Postgres, no dual-store split.
- **xlsx parser** with openpyxl: sheet metadata, formula counts, sample
  rows, seeded risks.
- **Tool registry** with the v0.1 catalog the LLM can call.
- **Ollama loop** wired to `gemma4:e2b`, capped at 8 tool-call rounds.
- **FastAPI daemon** with `/healthz`, upload, review, chat, item decisions.
- **Tests**: `tests/test_smoke.py` (unit) and `tests/test_llm_live.py`
  (live, skipped automatically if Ollama is down).

### LLM tool catalog (read vs write boundary)

Read tools (no side effects):

- `list_workbooks`
- `get_review_snapshot(workbook_id)`
- `inspect_sheet(workbook_id, sheet_name)`
- `list_risks(workbook_id)`

Write tools (stage a pending proposal item; never mutate a workbook):

- `propose_diff(workbook_id, cell, kind, before?, after?, rationale)`
- `add_comment(workbook_id, cell, body)`

The registry enforces this split. The model has no path to a real write.

### Legacy (`legacy/`)

The Node + React prototype lives here for reference. It is not built or
tested by the current setup. Do not extend it. Port useful logic into
the Python core when needed.

## Working Rules For Future Agents

- Read [`docs/development-plan.md`](docs/development-plan.md) first.
- Never add an LLM-driven write path that bypasses approval. Write tools
  must only stage proposal items.
- Keep the platform model-agnostic. Gemma 4 is the default; the LLM
  adapter must support swapping models.
- Prefer extending the Pydantic domain model in `core/spreadbread_core/domain.py`
  before adding ad-hoc shapes elsewhere.
- Keep runtime data out of git. `core/.data/` and `core/.venv/` are
  ignored.
- Do not edit files in `legacy/`. Port forward, do not maintain backward.
- One language per layer: Python in `core/` and `extension/`. No TypeScript
  outside `legacy/`.

## Useful Verification Commands

From repo root:

- Install core deps:
  `cd core && python3 -m venv .venv && .venv/bin/pip install -e .[dev]`
- Run daemon:
  `cd core && .venv/bin/spreadbread-core`
- Run tests:
  `cd core && .venv/bin/python -m pytest -q`
- Health check:
  `curl http://127.0.0.1:8765/healthz`
- List Ollama models:
  `ollama list`

## Current Technical Constraints

- Persistence is SQLite only. Postgres is a future option behind the
  same store interface.
- Workbook parsing is structural: formula counts, sample rows, no
  evaluation. LibreOffice / Excel evaluate formulas.
- Apply pipeline (write a new `.xlsx` from approved diffs) is not yet
  implemented — see development plan Phase 3.
- LibreOffice extension is scaffolded as a directory; the UNO component
  is next — see development plan Phase 2.
- No auth, no tenancy. Single-user local install.

## Recommended Next Steps

In order:

1. Scaffold the LibreOffice extension (`extension/`): manifest, Python
   UNO component, daemon HTTP client, sidebar stub.
2. Implement the apply pipeline (`POST /api/proposals/{id}/apply`).
3. Add Calc bridge in the extension to write approved diffs to the
   active sheet.
4. Enrich the parser (dependency graph, stale inputs, named ranges).
5. Expose the tool catalog over MCP stdio for external agent clients.

## Current Git State Expectation

Branch: `main`. Remote: `origin`. Before starting work:

- `git status --short --branch`
- `git remote -v`
- `gh auth status`

Prefer small commits after each validated slice.
