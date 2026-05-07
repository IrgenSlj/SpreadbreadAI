# SpreadbreadAI

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

- ✅ **Core daemon scaffold landed** — domain model, SQLite store, xlsx
  parser, tool registry, Ollama tool-calling loop, FastAPI HTTP API,
  pytest suites including a live Gemma 4 E2B integration test.
- 🚧 **LibreOffice extension** — scaffolding next.
- 📚 **Development plan:** [`docs/development-plan.md`](docs/development-plan.md).
- 🗄️ **Legacy Node + React prototype:** preserved under
  [`legacy/`](legacy/) for reference. No longer the supported runtime.

## Quick start

Prereqs: Python 3.11+, [Ollama](https://ollama.com), and
`ollama pull gemma4:e2b` (≈7 GB).

```bash
cd core
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/spreadbread-core            # serves on 127.0.0.1:8765
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
core/         Python daemon — domain, store, parser, tools, llm, http
extension/    LibreOffice .oxt plugin (in progress)
docs/         development plan, product, architecture, ADRs, runbooks
legacy/       frozen Node + React prototype (reference only)
```

## Documentation

- [`docs/development-plan.md`](docs/development-plan.md) — phased plan, what is built, what is next.
- [`docs/product/prd.md`](docs/product/prd.md) — product requirements.
- [`docs/architecture/system-architecture.md`](docs/architecture/system-architecture.md) — components and contracts.
- [`docs/architecture/mcp-tools.md`](docs/architecture/mcp-tools.md) — tool surface.
- [`docs/runbooks/setup.md`](docs/runbooks/setup.md) — local setup.
- [`docs/adr/0001-architecture-principles.md`](docs/adr/0001-architecture-principles.md) — non-negotiables.

## License

See [`LICENSE`](LICENSE).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The single hardest rule:
no write path may bypass human approval.
