# SpreadbreadAI

[![CI](https://github.com/IrgenSlj/SpreadbreadAI/actions/workflows/ci.yml/badge.svg)](https://github.com/IrgenSlj/SpreadbreadAI/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/IrgenSlj/SpreadbreadAI?include_prereleases&sort=semver)](https://github.com/IrgenSlj/SpreadbreadAI/releases)

> Open-source, human-in-the-loop AI review for spreadsheets.
> Runs locally on free LLMs. Lives inside LibreOffice Calc.

SpreadbreadAI is **not** chat-with-spreadsheet. It is a governed control
plane: AI inspects workbooks, drafts proposals, and explains its
reasoning — humans review every diff and approve every write.

## Architecture at a glance

- **LibreOffice Calc plugin** (`extension/`) — Python UNO sidebar that
  reviewers use right next to their cells.
- **Local Python daemon** (`core/`) — FastAPI + SQLite, owns workbooks,
  proposals, diffs, and the audit trail. Runs on `127.0.0.1:8765`.
- **Local LLM by default** — Gemma 4 E2B via Ollama, with tool calling
  so the model can read workbooks and stage proposals (but never write).

The model has the same permissions as a junior analyst: it can suggest;
it cannot apply.

## Project status

- ✅ **Core daemon** — domain model, SQLite store, xlsx parser, tool
  registry, Ollama tool-calling loop, FastAPI HTTP API, apply pipeline.
- ✅ **LibreOffice extension v0.1** — Python UNO plugin with daemon
  client, Calc bridge, and `.oxt` build script.
- ✅ **Apply pipeline** — approved diffs commit a new canonical `.xlsx`
  version, idempotent and audited.
- 🚧 **Real sidebar UI** — replacing the v0.1 message-box review surface.
- 📚 **Development plan:** [`docs/development-plan.md`](docs/development-plan.md).

## Install

### Prerequisites

- **Python 3.11+** (3.13/3.14 also tested)
- **[Ollama](https://ollama.com)** running locally
- The default model: `ollama pull gemma4:e2b` (≈7 GB on disk)
- **LibreOffice 7+** (only needed for the Calc plugin path)

### Option A — Recommended (clone + editable install)

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

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md),
and [`SECURITY.md`](SECURITY.md). The single hardest rule:
no write path may bypass human approval.
