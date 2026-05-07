# Local Setup

## Prereqs

- Python 3.11+ (3.14 tested)
- [Ollama](https://ollama.com) running locally
- A pulled model: `ollama pull gemma4:e2b` (≈7 GB)

## Install and run the core daemon

```bash
cd core
python3 -m venv .venv
.venv/bin/pip install -e .[dev]
.venv/bin/spreadbread-core
```

The daemon listens on `127.0.0.1:8765`. Verify:

```bash
curl http://127.0.0.1:8765/healthz
```

You should see something like:

```json
{
  "ok": true,
  "model": "gemma4:e2b",
  "tools": ["list_workbooks", "get_review_snapshot", "inspect_sheet",
            "list_risks", "propose_diff", "add_comment"]
}
```

## Run the tests

```bash
cd core
.venv/bin/python -m pytest -q
```

The live LLM test (`tests/test_llm_live.py`) is skipped automatically
if Ollama is not reachable.

## Configuration

Environment variables, all optional:

- `SPREADBREAD_DATA_DIR` — where SQLite + uploads live (default `core/.data/`)
- `SPREADBREAD_MODEL` — Ollama model tag (default `gemma4:e2b`)
- `OLLAMA_HOST` — Ollama URL (default `http://127.0.0.1:11434`)
- `SPREADBREAD_HOST` / `SPREADBREAD_PORT` — daemon bind (default `127.0.0.1:8765`)

## LibreOffice extension

In progress. See [`extension/README.md`](../../extension/README.md) and
[`docs/development-plan.md`](../development-plan.md) Phase 2.

## Resetting local state

Delete `core/.data/` to wipe the SQLite database and uploaded workbooks.
The directory is gitignored.

