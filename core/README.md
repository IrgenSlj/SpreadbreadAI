# spreadbread-core

The local SpreadbreadAI gateway and engine: FastAPI + SQLite + Ollama,
with the domain model, parser, tool registry, LLM loop, MCP bridge,
and apply pipeline.

This package is part of [SpreadbreadAI](https://github.com/IrgenSlj/SpreadbreadAI).
See the repository README and `docs/development-plan.md` for the full
picture, including the LibreOffice extension that talks to this daemon.

## Direction

`core/` is the provider-neutral engine for spreadsheet and document work.
Landed:

- agent modes: inspect, plan, propose, apply, direct, locked
- typed operation IR with lifecycle CRUD and HTTP API
- provider adapters: `LocalXlsxAdapter`, `GoogleSheetsAdapter` (lazy registry)
- run/session tracing with tool-call recording
- resource model with generic `/api/resources/` routes
- permission policy filtering by mode (explicit allow/ask/deny pending)

Still building:

- artifact-centered UI
- skills registry
- MCP hardening

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
- `SPREADBREAD_GEMINI_KEY` — Google Gemini API key (optional, enables Gemini adapter)
- `SPREADBREAD_GOOGLE_TOKEN` — Google Sheets OAuth access token (optional)

## Test

```bash
.venv/bin/python -m pytest -q
```

The live LLM test is skipped when Ollama is unreachable.
