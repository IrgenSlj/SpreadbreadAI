# SpreadbreadAI

[![CI](https://github.com/IrgenSlj/SpreadbreadAI/actions/workflows/ci.yml/badge.svg)](https://github.com/IrgenSlj/SpreadbreadAI/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/IrgenSlj/SpreadbreadAI?include_prereleases&sort=semver)](https://github.com/IrgenSlj/SpreadbreadAI/releases)

SpreadbreadAI is an open-source spreadsheet AI assistant with
human-in-the-loop controls, built for enterprise and professional use.
It runs locally on free LLMs, inspects and edits workbooks through a
defined tool catalog, and produces a versioned audit trail of every
change.

It ships as a LibreOffice Calc plugin and a local daemon. External
agents (Claude Desktop, Cursor, VS Code, Codex) can drive the same
toolset over MCP.

## What it does

- Parses uploaded `.xlsx` workbooks and surfaces structural risks.
- Lets a local LLM read sheets, list risks, and stage proposed edits.
- Routes every write through an explicit approval and an immutable,
  versioned `.xlsx` snapshot.
- Records an append-only audit trail of every tool call, decision,
  and applied change.
- Runs fully offline by default; cloud LLMs are opt-in.

## Architecture

- `extension/` — LibreOffice Calc plugin (Python UNO). Three menu
  actions cover the full Review → Approve → Apply loop.
- `core/` — Python daemon (FastAPI + SQLite + openpyxl) on
  `127.0.0.1:8765`. Owns workbooks, proposals, diffs, and audit
  events.
- LLM layer — Ollama with `gemma4:e2b` by default; the adapter is
  pluggable for larger local models or cloud providers.
- MCP server — `spreadbread-mcp` exposes the same tool registry over
  stdio for external AI clients.

## Tool catalog

Read tools (no side effects): `list_workbooks`, `get_review_snapshot`,
`inspect_sheet`, `list_risks`. Write-staging tools (create pending
proposal items, never mutate workbooks directly): `propose_diff`,
`add_comment`. The registry enforces this split — there is no tool
the LLM can call that bypasses the approval pipeline.

## Status

Landed in `v0.1.2`:

- Core daemon: domain model, SQLite store, xlsx parser, tool registry,
  Ollama tool-calling loop, FastAPI HTTP API.
- Apply pipeline with conflict detection, sha256 base-bytes guard, and
  idempotent re-apply.
- LibreOffice extension v0.1 with the Review → Approve → Apply menu.
- MCP stdio server (`spreadbread-mcp`) for external AI clients.
- Single shared cell-reference parser covering absolute refs, ranges,
  quoted sheet names, and named-range identifiers.

In progress: real sidebar UI to replace the message-box review
surface, multi-LLM adapter (Gemini / OpenAI / Anthropic), expanded
parser intelligence (dependency graphs, stale-input detection).
See [`docs/development-plan.md`](docs/development-plan.md) for the
phased plan.

## Install

### Recommended — native installer (in development)

A native installer per OS is being wired up in `packaging/`. Once
released it is the simplest path: download one file, double-click, the
launcher takes care of the rest (Ollama, model pull, LibreOffice
extension registration, daemon supervision via a tray icon).

Until the first signed release lands, use one of the developer paths
below.

### Prerequisites for the developer paths

- **Python 3.11+** (3.13/3.14 also tested)
- **[Ollama](https://ollama.com)** running locally
- The default model: `ollama pull gemma4:e2b` (≈7 GB on disk)
- **LibreOffice 7+** (only needed for the Calc plugin path)

### Option A — Clone + editable install

This is the path I have actually verified end-to-end, including the
real Gemma 4 review loop. Use this for the first test.

```bash
git clone https://github.com/IrgenSlj/SpreadbreadAI.git
cd SpreadbreadAI/core
python3 -m venv .venv
.venv/bin/pip install -e . --config-settings editable_mode=compat
.venv/bin/spreadbread-core            # daemon: http://127.0.0.1:8765
```

Sanity-check in another terminal:

```bash
curl http://127.0.0.1:8765/healthz
```

Build and install the LibreOffice extension:

```bash
cd ../extension
./build.sh
unopkg add spreadbreadai.oxt          # restart LibreOffice afterward
```

### Connect from an external AI tool (MCP)

The same tool catalog the local LLM uses is also exposed over MCP
stdio, so Claude Desktop, Cursor, or VS Code agents can drive
SpreadbreadAI directly. Add an entry like this to your client's MCP
config:

```json
{
  "mcpServers": {
    "spreadbreadai": {
      "command": "spreadbread-mcp"
    }
  }
}
```

External tool calls flow through the same registry — write tools
stage proposal items; nothing touches a workbook without an
approval going through `apply`.

### Option B — Install from a published release

Grab the artifacts from the
[latest release](https://github.com/IrgenSlj/SpreadbreadAI/releases/latest):

```bash
# daemon (recommend pipx so it lives in its own env)
pipx install https://github.com/IrgenSlj/SpreadbreadAI/releases/download/v0.1.1/spreadbread_core-0.1.1-py3-none-any.whl

# extension
curl -L -o spreadbreadai.oxt \
  https://github.com/IrgenSlj/SpreadbreadAI/releases/download/v0.1.1/spreadbreadai.oxt
unopkg add spreadbreadai.oxt
```

### Option C — Bootstrap script (less tested)

```bash
curl -fsSL https://raw.githubusercontent.com/IrgenSlj/SpreadbreadAI/main/scripts/install.sh | bash
```

It installs `pipx` if missing, installs the daemon from this repo,
ensures Ollama, and pulls `gemma4:e2b`. You still install the `.oxt`
manually after.

## Your first test (5 minutes)

Once the daemon is running and the extension is installed, the loop is
three menu clicks:

1. Open any `.xlsx` workbook in LibreOffice Calc and save it to disk.
2. **SpreadbreadAI → 1. Review with SpreadbreadAI**
   The extension uploads the file, asks Gemma 4 to inspect it, and shows
   the staged proposal items in a message box. Items are `pending`.
3. **SpreadbreadAI → 2. Approve all pending items**
   A confirmation dialog lists the diffs. Click *Yes* to flip them all
   to `approved`. (This is your human-in-the-loop checkpoint — nothing
   has touched your workbook yet.)
4. **SpreadbreadAI → 3. Apply approved diffs**
   The extension writes the approved cells into the active sheet and
   the daemon commits a new canonical `.xlsx` version under
   `core/.data/workbooks/<workbook_id>/`. The audit trail records every
   step.

If you prefer to drive it from a terminal instead of LibreOffice, use
the [HTTP API](docs/architecture/system-architecture.md#api-surface):

```bash
# 1. upload
WB=$(curl -s -F "file=@/tmp/sample.xlsx" \
  http://127.0.0.1:8765/api/workbooks/upload | jq -r .id)
# 2. ask Gemma 4 to review
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"message":"review this workbook"}' \
  "http://127.0.0.1:8765/api/workbooks/$WB/chat"
# 3. find the proposal, approve all pending, apply
PROP=$(curl -s "http://127.0.0.1:8765/api/workbooks/$WB/review" | jq -r .proposal.id)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"decision":"approve","reviewer":"me"}' \
  "http://127.0.0.1:8765/api/proposals/$PROP/approve-all"
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"reviewer":"me"}' \
  "http://127.0.0.1:8765/api/proposals/$PROP/apply"
```

Sanity-check it:

```bash
curl http://127.0.0.1:8765/healthz
```

Run the test suite (live LLM test is skipped automatically if Ollama is
not reachable):

```bash
cd core && .venv/bin/pip install pytest
.venv/bin/python -m pytest -q
```

## Repository layout

```text
core/         Python daemon — domain, store, parser, tools, llm, apply, http
extension/    LibreOffice .oxt plugin (Python UNO)
docs/         development plan, product, architecture, ADRs, runbooks
```

## Documentation

- [`docs/development-plan.md`](docs/development-plan.md) — phased plan, what is built, what is next.
- [`docs/product/prd.md`](docs/product/prd.md) — product requirements.
- [`docs/architecture/system-architecture.md`](docs/architecture/system-architecture.md) — components and contracts.
- [`docs/architecture/mcp-tools.md`](docs/architecture/mcp-tools.md) — tool surface.
- [`docs/runbooks/setup.md`](docs/runbooks/setup.md) — local setup.
- [`docs/adr/0001-architecture-principles.md`](docs/adr/0001-architecture-principles.md) — non-negotiables.

## License

Apache 2.0. See [`LICENSE`](LICENSE).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md),
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and
[`SECURITY.md`](SECURITY.md). Every contribution is expected to
preserve the approval and audit guarantees that the registry, store,
and apply pipeline enforce.
