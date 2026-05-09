# SpreadbreadAI LibreOffice Extension

A Python UNO extension that surfaces SpreadbreadAI inside LibreOffice
Calc. The extension is a thin client; all logic lives in the daemon
at `127.0.0.1:8765`.

## Status

v0.1 scaffold landed. See [`docs/development-plan.md`](../docs/development-plan.md) Phase 2.

What works:

- protocol handler `spreadbread:review` and `spreadbread:apply`
- "SpreadbreadAI" menu in Calc with two entries
- daemon client (stdlib only — no third-party deps inside LO Python)
- workbook upload + review request triggers a Gemma 4 review and shows
  results in a message box
- cell-reference parser and Calc bridge for the upcoming apply flow

What is next (Phase 2.5):

- replace the temporary message box with a real sidebar `.ui` panel
- per-item approve / reject buttons inside the sidebar
- wire `spreadbread:apply` to the daemon's apply endpoint (Phase 3)

## Layout

```text
extension/
  manifest/              META-INF, description.xml, Addons.xcu, ProtocolHandler.xcu
  python/
    main.py              UNO component entry point
    spreadbreadai/       package: client, sidebar, calc_bridge
  tests/                 pytest tests for the client and cell parser
  build.sh               packages → spreadbreadai.oxt
  pyproject.toml         dev dependencies and pytest config
```

## Building

```bash
cd extension && ./build.sh
# produces extension/spreadbreadai.oxt
```

## Installing in LibreOffice

```bash
unopkg add extension/spreadbreadai.oxt
# or: Tools → Extension Manager → Add → spreadbreadai.oxt
```

The extension expects the SpreadbreadAI daemon to be running at
`http://127.0.0.1:8765` (override with `SPREADBREAD_DAEMON`). Start the
daemon with:

```bash
cd core && .venv/bin/spreadbread-core
```

## Running tests

```bash
cd extension
../core/.venv/bin/pip install pytest
../core/.venv/bin/python -m pytest -q
```
