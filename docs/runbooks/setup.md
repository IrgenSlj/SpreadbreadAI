# Local Setup

This runbook covers the low-cost development path: local daemon,
SQLite, Ollama, and the LibreOffice extension. No cloud account or paid
API is required for the default workflow.

## Prereqs

- Python 3.11+
- [Ollama](https://ollama.com) running locally
- A pulled model: `ollama pull gemma4:e2b`
- LibreOffice 7+ for the Calc extension path

## Install and run the core daemon

```bash
cd core
python3 -m venv .venv
.venv/bin/pip install -e .[dev] --config-settings editable_mode=compat
.venv/bin/spreadbread-core
```

The `--config-settings editable_mode=compat` flag works around a pip /
setuptools combo that can produce a non-editable static copy in
`site-packages`. Verify by checking that
`.venv/lib/python*/site-packages/spreadbread_core-*.dist-info/direct_url.json`
contains `"editable": true`.

The daemon listens on `127.0.0.1:8765`. Verify:

```bash
curl http://127.0.0.1:8765/healthz
```

Expected shape:

```json
{
  "ok": true,
  "model": "gemma4:e2b",
  "tools": [
    "list_workbooks",
    "get_review_snapshot",
    "inspect_sheet",
    "list_risks",
    "get_dependencies",
    "find_external_references",
    "get_named_ranges",
    "propose_diff",
    "add_comment"
  ]
}
```

## Run tests

```bash
cd core
.venv/bin/python -m pytest -q

cd ../extension
../core/.venv/bin/python -m pytest -q -c pyproject.toml
```

The live LLM test is skipped automatically if Ollama is not reachable.

## Run lint

```bash
./core/.venv/bin/python -m ruff check core/spreadbread_core extension/python
```

## Build the LibreOffice extension

```bash
cd extension
./build.sh
unopkg add spreadbreadai.oxt
```

After restarting LibreOffice, the **SpreadbreadAI** menu appears in
Calc with three numbered actions:

1. *Review with SpreadbreadAI* — uploads the active workbook and asks
   the local agent to inspect it.
2. *Approve all pending items* — opens a confirmation dialog listing
   staged diffs.
3. *Apply approved diffs* — commits approved operations through the
   daemon and mirrors approved cells into the active sheet.

The extension expects the daemon at `http://127.0.0.1:8765`. Override
with the `SPREADBREAD_DAEMON` environment variable in LibreOffice's
launch environment if you need a non-default address.

## MCP server

Run the MCP stdio server for clients such as Claude Desktop, Cursor, VS
Code, or Codex:

```bash
cd core
.venv/bin/spreadbread-mcp
```

MCP tools use the same daemon tool registry and policy model. Write
tools stage proposal items/operations; provider mutation still goes
through apply.

## Agent modes over HTTP

The chat endpoint accepts an optional mode. Default is `propose`.

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"message":"inspect this workbook only","mode":"inspect"}' \
  "http://127.0.0.1:8765/api/workbooks/$WB/chat"
```

Inspect the filtered tool schema:

```bash
curl "http://127.0.0.1:8765/api/tools?mode=inspect"
```

The chat response includes `run_id`. The daemon also records
`agent.run.started` and `agent.run.completed` audit events for that
run.

Fetch run history:

```bash
curl "http://127.0.0.1:8765/api/workbooks/$WB/runs"
curl "http://127.0.0.1:8765/api/runs/$RUN_ID"
```

## Configuration

Environment variables, all optional:

- `SPREADBREAD_DATA_DIR` — where SQLite and uploads live
- `SPREADBREAD_MODEL` — Ollama model tag, default `gemma4:e2b`
- `OLLAMA_HOST` — Ollama URL, default `http://127.0.0.1:11434`
- `SPREADBREAD_HOST` / `SPREADBREAD_PORT` — daemon bind, default
  `127.0.0.1:8765`

Future cloud and Google provider credentials should live outside the
repo in user config/credential files. They must not be required for
default tests or local demo runs.

## Reset local state

Delete the configured `SPREADBREAD_DATA_DIR` to wipe the SQLite
database and uploaded workbooks. If unset, the default is your OS
user-data directory, such as:

- macOS: `~/Library/Application Support/SpreadbreadAI/data`
- Linux: `~/.local/share/spreadbreadai/data`

## Baseline verification before architecture work

Run this before large refactors:

```bash
cd core
.venv/bin/python -m pytest -q

cd ../extension
../core/.venv/bin/python -m pytest -q -c pyproject.toml

cd ..
./core/.venv/bin/python -m ruff check core/spreadbread_core extension/python
```

If a future sprint touches packaging, also run:

```bash
cd extension
./build.sh
```
