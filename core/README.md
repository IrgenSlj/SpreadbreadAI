# spreadbread-core

The local SpreadbreadAI daemon: FastAPI + SQLite + Ollama, with the
domain model, parser, tool registry, LLM loop, and apply pipeline.

This package is part of [SpreadbreadAI](https://github.com/IrgenSlj/SpreadbreadAI).
See the repository README and `docs/development-plan.md` for the full
picture, including the LibreOffice extension that talks to this daemon.

## Install (from a checkout)

```bash
python3 -m venv .venv
.venv/bin/pip install -e .[dev]
.venv/bin/spreadbread-core            # serves on 127.0.0.1:8765
```

## Configuration

All optional, all environment variables:

- `SPREADBREAD_DATA_DIR` — SQLite + workbook bytes (default `./.data/`)
- `SPREADBREAD_MODEL` — Ollama model tag (default `gemma4:e2b`)
- `OLLAMA_HOST` — Ollama URL (default `http://127.0.0.1:11434`)
- `SPREADBREAD_HOST` / `SPREADBREAD_PORT` — bind (default `127.0.0.1:8765`)

## Test

```bash
.venv/bin/python -m pytest -q
```

The live LLM test is skipped when Ollama is unreachable.
