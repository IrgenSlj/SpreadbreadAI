# spreadbread-core

The local SpreadbreadAI gateway and engine: FastAPI + SQLite + Ollama,
with the domain model, parser, tool registry, LLM loop, MCP bridge,
and apply pipeline.

This package is part of [SpreadbreadAI](https://github.com/IrgenSlj/SpreadbreadAI).
See the repository README and `docs/development-plan.md` for the full
picture, including the LibreOffice extension that talks to this daemon.

## Direction

`core/` is becoming the provider-neutral engine for spreadsheet and
document work:

- agent modes: inspect, plan, propose, apply, and bounded direct mode
- typed operation IR before provider mutation
- permission policy for native tools, skills, and MCP tools
- artifact-centered proposal and audit data for UI clients
- provider adapters for LibreOffice/local xlsx first, Google Sheets
  next, and document providers later

## Install (from a checkout)

```bash
python3 -m venv .venv
.venv/bin/pip install -e .[dev]
.venv/bin/spreadbread-core            # serves on 127.0.0.1:8765
```

## Configuration

All optional, all environment variables:

- `SPREADBREAD_DATA_DIR` — SQLite + workbook bytes (default: OS user-data directory)
- `SPREADBREAD_MODEL` — Ollama model tag (default `gemma4:e2b`)
- `OLLAMA_HOST` — Ollama URL (default `http://127.0.0.1:11434`)
- `SPREADBREAD_HOST` / `SPREADBREAD_PORT` — bind (default `127.0.0.1:8765`)

## Test

```bash
.venv/bin/python -m pytest -q
```

The live LLM test is skipped when Ollama is unreachable.
