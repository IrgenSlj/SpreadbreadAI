# SpreadbreadAI

[![CI](https://github.com/IrgenSlj/SpreadbreadAI/actions/workflows/ci.yml/badge.svg)](https://github.com/IrgenSlj/SpreadbreadAI/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/IrgenSlj/SpreadbreadAI?include_prereleases&sort=semver)](https://github.com/IrgenSlj/SpreadbreadAI/releases)

SpreadbreadAI is an open-source, local-first agentic workspace for
complex spreadsheet and document work. It combines AI agents, typed
operations, provider adapters, skills, MCP integrations, immutable
versions, and audit trails so users can safely automate serious office
work without surrendering control of their data.

The current implementation ships as a LibreOffice Calc extension and a
local Python daemon. That path remains the first provider and testbed.
The new architecture prepares the same core engine for Google Sheets,
Google Docs, Excel, local files, and other document providers.

## Product direction

The UX target is **conversation-led, artifact-centered, and
policy-gated**:

- users start work through chat or command-style prompts
- the app turns agent work into artifacts: findings, proposed
  operations, diffs, validation results, dependency impact, and audit
  events
- trust modes decide whether operations require review, per-item
  approval, or bounded auto-apply
- every provider mutation goes through the same operation, apply, and
  audit pipeline

Review-and-approve is a safety layer, not the whole product. Chat is
the entry point, not the system of record.

## What it does today

- Parses uploaded `.xlsx` workbooks and surfaces structural risks.
- Lets a local LLM inspect sheets, list risks, and stage proposed edits.
- Routes writes through proposal/apply policy, producing immutable
  workbook versions and audit events.
- Supports trust modes: `review`, `locked`, and opt-in `direct`.
- Exposes the same tool registry over MCP for external AI clients.
- Runs fully offline by default; cloud LLMs are opt-in.

## Target architecture

- `core/` — local gateway and engine: FastAPI, SQLite, parser, agent
  runtime, tool registry, MCP bridge, operation/apply pipeline.
- `extension/` — LibreOffice Calc provider UI and sync shell. It stays
  thin; the daemon owns policy and state.
- `provider adapters` — LibreOffice/local xlsx first, Google Sheets
  next, Google Docs and Excel later.
- `skills` — workflow instructions such as formula audit, month-end
  close review, scenario modeling, and report generation.
- `MCP` — integration boundary for external agents and tools, routed
  through the same permission policy.
- `artifact UI` — planned local web/sidebar surface for findings,
  operations, diffs, validation, and audit timeline.

## Tool catalog

Read tools have no side effects:

- `list_workbooks`
- `get_review_snapshot`
- `inspect_sheet`
- `list_risks`
- `get_dependencies`
- `find_external_references`
- `get_named_ranges`

Write-staging tools create proposal items and never mutate providers
directly:

- `propose_diff`
- `add_comment`

The next architecture slice generalizes these into a typed operation
IR so providers can implement the same operations with different APIs.

## Status

Landed:

- Core daemon: domain model, SQLite store, xlsx parser, tool registry,
  Ollama tool-calling loop, FastAPI HTTP API.
- Apply pipeline with conflict detection, sha256 base-bytes guard, and
  idempotent re-apply.
- LibreOffice extension v0.1 with Review, Approve all, and Apply menu
  actions.
- MCP stdio server (`spreadbread-mcp`) for external AI clients.
- Risk detection for external workbook refs, broken sheet refs, stale
  markers, named ranges, and dependencies.
- Trust modes: `direct`, `review`, and `locked`.

Current direction:

- operation IR and provider capability model
- explicit agent modes: inspect, plan, propose, apply, direct
- artifact-centered UI instead of message-box review
- skills registry and permission-gated MCP/tool exposure
- Google Sheets adapter after the core operation model is stable

See [`docs/development-plan.md`](docs/development-plan.md) for the
multisession sprint plan.

## Install

### Recommended later: native installer

Native installers are scaffolded in `packaging/` but still in
development. Until signed releases are ready, use the developer path.

### Prerequisites

- Python 3.11+
- [Ollama](https://ollama.com) running locally
- default model: `ollama pull gemma4:e2b`
- LibreOffice 7+ for the Calc extension path

### Developer path

```bash
git clone https://github.com/IrgenSlj/SpreadbreadAI.git
cd SpreadbreadAI/core
python3 -m venv .venv
.venv/bin/pip install -e .[dev] --config-settings editable_mode=compat
.venv/bin/spreadbread-core
```

Sanity-check in another terminal:

```bash
curl http://127.0.0.1:8765/healthz
```

Build and install the LibreOffice extension:

```bash
cd ../extension
./build.sh
unopkg add spreadbreadai.oxt
```

### Connect from an external AI tool over MCP

```json
{
  "mcpServers": {
    "spreadbreadai": {
      "command": "spreadbread-mcp"
    }
  }
}
```

External tool calls flow through the same registry. Write-capable tools
stage proposal items; provider mutation goes through apply.

## First local test

1. Open any `.xlsx` workbook in LibreOffice Calc and save it to disk.
2. Click **SpreadbreadAI -> 1. Review with SpreadbreadAI**.
3. Click **SpreadbreadAI -> 2. Approve all pending items**.
4. Click **SpreadbreadAI -> 3. Apply approved diffs**.

The daemon commits the canonical workbook version and records the audit
trail. The extension mirrors approved cells into the active sheet as a
user-facing convenience.

## Run tests

```bash
cd core
.venv/bin/python -m pytest -q

cd ../extension
../core/.venv/bin/python -m pytest -q -c pyproject.toml
```

Live LLM tests skip automatically if Ollama is not reachable.

## Documentation

- [`docs/development-plan.md`](docs/development-plan.md) — multisession sprint plan.
- [`docs/product/prd.md`](docs/product/prd.md) — product requirements.
- [`docs/product/ux-principles.md`](docs/product/ux-principles.md) — artifact-centered UX direction.
- [`docs/product/roadmap.md`](docs/product/roadmap.md) — roadmap.
- [`docs/architecture/system-architecture.md`](docs/architecture/system-architecture.md) — target architecture and contracts.
- [`docs/architecture/operation-ir.md`](docs/architecture/operation-ir.md) — provider-neutral operation contract.
- [`docs/architecture/skills-and-policy.md`](docs/architecture/skills-and-policy.md) — skills and permission policy.
- [`docs/architecture/mcp-tools.md`](docs/architecture/mcp-tools.md) — tool, skill, MCP, and policy surface.
- [`docs/runbooks/setup.md`](docs/runbooks/setup.md) — local setup.
- [`docs/adr/0001-architecture-principles.md`](docs/adr/0001-architecture-principles.md) — architecture principles.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
