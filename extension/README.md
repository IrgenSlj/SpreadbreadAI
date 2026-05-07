# SpreadbreadAI LibreOffice Extension

A Python UNO extension that turns LibreOffice Calc into a human-in-the-loop
AI review surface. The extension is a thin sidebar — all logic lives in the
core daemon at `127.0.0.1:8765`.

## Status

Scaffold in progress. See `docs/development-plan.md` Phase 2.

## Planned Layout

```text
extension/
  manifest/              META-INF, description.xml, Addons.xcu, Sidebar.xcu
  python/
    spreadbreadai/       package: client, sidebar, calc bridge
    main.py              UNO component entry point
  build.sh               packages → spreadbreadai.oxt
  tests/                 unit tests for the daemon client
```

## Building

Once scaffolded:

```bash
cd extension && ./build.sh
# produces extension/spreadbreadai.oxt
```

Install with `unopkg add spreadbreadai.oxt` or via Tools → Extension Manager.
