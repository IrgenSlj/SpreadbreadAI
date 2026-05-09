# Local Setup

## Prereqs

- Python 3.11+ (3.14 tested)
- [Ollama](https://ollama.com) running locally
- A pulled model: `ollama pull gemma4:e2b` (≈7 GB)

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

Build the `.oxt`:

```bash
cd extension && ./build.sh
unopkg add spreadbreadai.oxt
```

After restarting LibreOffice, the **SpreadbreadAI** menu appears in
Calc with three numbered actions:

1. *Review with SpreadbreadAI* — uploads the active workbook and asks
   Gemma 4 to draft proposal items.
2. *Approve all pending items* — opens a confirmation dialog listing
   the staged diffs. This is the human-in-the-loop step.
3. *Apply approved diffs* — writes approved cells into the active sheet
   and commits a new canonical version on the daemon side.

The extension expects the daemon at `http://127.0.0.1:8765`. Override
with the `SPREADBREAD_DAEMON` environment variable in LibreOffice's
launch environment if you need a non-default address.

## Resetting local state

Delete `core/.data/` to wipe the SQLite database and uploaded workbooks.
The directory is gitignored.

