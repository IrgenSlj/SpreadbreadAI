# SpreadbreadAI Agent Handoff

## Project summary

SpreadbreadAI is an open-source, local-first agentic workspace for
complex spreadsheet and document work. The current implementation is a
LibreOffice Calc extension backed by a local Python daemon. The target
architecture generalizes that local loop into a provider-neutral engine
with typed operations, provider adapters, skills, MCP integrations,
agent modes, artifact-centered UI, and audited apply.

Read [`docs/development-plan.md`](docs/development-plan.md) before
starting work. It is the execution source of truth.

## Current direction

The product is moving from:

```text
LibreOffice spreadsheet assistant with review/apply
```

to:

```text
local-first agentic workspace for spreadsheet/document operations
```

Important principles:

- local-first and low-cost by default
- Ollama/local model default
- SQLite/local files default
- no required cloud service during development/beta
- provider adapters at the edge
- typed operations before provider mutation
- policy enforced in code, not prompts
- MCP and skills do not bypass policy
- artifact-centered UX, not chat-only and not review-only

## Repository layout

```text
core/                   Python daemon/gateway
  spreadbread_core/
    domain.py           Pydantic models: Workbook, Proposal, Item, Audit
    store.py            SQLite repository + xlsx version bytes
    parser.py           openpyxl-based .xlsx parser
    tools.py            tool registry exposed to LLM/MCP
    llm.py              Ollama tool-calling loop
    apply.py            apply pipeline
    http.py             FastAPI app + uvicorn entry
    config.py
  tests/                pytest suites
  pyproject.toml
extension/              LibreOffice .oxt extension
  manifest/             META-INF, description, Addons.xcu, ProtocolHandler.xcu
  python/               main.py + spreadbreadai package
  tests/                pytest tests
  build.sh              packages spreadbreadai.oxt
docs/                   product, architecture, ADRs, runbooks, plan
packaging/              native bundle/launcher scaffold
```

## What exists today

### Core daemon

- Domain model in Pydantic.
- SQLite store.
- xlsx parser with openpyxl.
- Workbook risks for external refs, broken sheet refs, stale markers,
  named ranges, and dependencies.
- Tool registry with read tools and write-staging tools.
- Ollama loop wired to local model default.
- FastAPI daemon with workbook, proposal, trust mode, chat, apply, and
  tool endpoints.
- MCP stdio server.
- Apply pipeline with conflict detection, base checksum guard,
  idempotence, immutable versions, and audit events.
- Mode-aware tool policy: `/chat` and `/api/tools` can filter tools by
  inspect/plan/propose/apply/direct/locked mode. Default chat mode is
  `propose`.
- Minimal `AgentRun` persistence: `/chat` returns `run_id` and writes
  run started/completed audit events.

### LibreOffice extension

- `spreadbread:review`, approve-all, and `spreadbread:apply` actions.
- Workbook upload and daemon review request.
- Confirmation dialog for staged diffs.
- Calc bridge for mirroring approved diffs after daemon apply succeeds.
- Current UI is still too thin; artifact/sidebar work is the next UX
  slice.

### Tool catalog

Read tools:

- `list_workbooks`
- `get_review_snapshot(workbook_id)`
- `inspect_sheet(workbook_id, sheet_name)`
- `list_risks(workbook_id)`
- `get_dependencies(workbook_id, cell)`
- `find_external_references(workbook_id)`
- `get_named_ranges(workbook_id)`

Write-staging tools:

- `propose_diff(workbook_id, cell, kind, before?, after?, after_type?, rationale)`
- `add_comment(workbook_id, cell, body)`

There is no model-exposed direct provider write tool. Do not add one.

## Next architecture contracts

Add these incrementally:

1. Operation IR mapped from current proposal items.
2. Provider capability model.
3. Explicit agent modes: inspect, plan, propose, apply, direct, locked.
4. Run/session tracing across prompt, tools, proposal, decisions, apply,
   versions, and audit.
5. Permission policy returning `allow`, `ask`, or `deny`.
6. Local skills registry using `skills/<name>/SKILL.md`.
7. Artifact API/UI for findings, operations, validation, impact, and timeline.
8. Google Sheets provider adapter only after the operation/policy
   contracts are stable.

## Working rules for agents

- Start by reading [`docs/development-plan.md`](docs/development-plan.md).
- Keep changes in the right layer: daemon owns behavior; provider UI
  shells stay thin.
- Never add agent, skill, MCP, or provider code that bypasses operation
  policy, validation, apply, versioning, or audit.
- Prefer additive migrations over rewrites.
- Prefer deterministic spreadsheet tools and validators before relying
  on larger models.
- Do not introduce required paid APIs, hosted infrastructure, Postgres,
  vector DBs, or plugin runtimes during development/beta.
- Use skills/config before Python plugin code when possible.
- Keep runtime data out of git. `core/.data/`, virtualenvs, and caches
  are ignored.

## Known traps

- Do not add `from __future__ import annotations` to
  `core/spreadbread_core/http.py`. FastAPI/Pydantic schema resolution
  can break body-model handling; `tests/test_http.py` guards this.
- If editable installs do not reflect source changes, reinstall core
  with:

```bash
cd core
.venv/bin/pip install -e .[dev] --config-settings editable_mode=compat
```

- The local API trusts localhost by default. Do not bind to a network
  interface without auth.

## Useful verification commands

From repo root:

```bash
cd core
.venv/bin/python -m pytest -q
```

```bash
cd extension
../core/.venv/bin/python -m pytest -q -c pyproject.toml
```

```bash
./core/.venv/bin/python -m ruff check core/spreadbread_core extension/python
```

```bash
cd extension
./build.sh
```

Run daemon:

```bash
cd core
.venv/bin/spreadbread-core
```

Run MCP server:

```bash
cd core
.venv/bin/spreadbread-mcp
```

Health check:

```bash
curl http://127.0.0.1:8765/healthz
```

## Recommended next work

Follow the sprint plan in [`docs/development-plan.md`](docs/development-plan.md):

1. Finish documentation/baseline verification.
2. Replace the message-box Calc review with artifact/sidebar UI.
3. Add operation IR while preserving current proposal behavior.
4. Add run/session tracing and explicit permission policy.
5. Add modes/resources/workspace spine.
6. Add local skills registry.
7. Add Google Sheets adapter after the core contracts are stable.

## Current git state expectation

Before starting substantial work:

```bash
git status --short --branch
git remote -v
```

Work in small, validated slices. Do not revert unrelated user changes.
