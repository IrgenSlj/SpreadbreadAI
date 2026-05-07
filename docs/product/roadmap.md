# Roadmap

This is a high-level view of phases. Detail and rationale live in
[`docs/development-plan.md`](../development-plan.md).

## Now (May 2026)

- ✅ Core daemon scaffold: domain, store, parser, tools, Ollama loop, FastAPI.
- ✅ Tool-calling integration with Gemma 4 E2B verified end-to-end.
- 🚧 LibreOffice extension scaffold (manifest, sidebar, Calc bridge).

## Next

- Apply pipeline: write approved diffs into a new `.xlsx` version.
- Calc bridge: extension writes approved cells into the active sheet
  and asks the daemon to persist the new version.
- Richer parser: dependency graph, stale inputs, named ranges, external
  reference detection.
- Packaging: `.oxt` build script, `pipx` distribution for the daemon.

## Later

- MCP stdio surface so Claude Code, Codex, and other clients can use
  the same tool catalog.
- Optional small web review UI for users without LibreOffice.
- Excel add-in reusing the same daemon.
- Multi-user deployment behind a Postgres driver.
- Reviewer profiles, RBAC, scoped access (port from legacy).

## Non-goals

- Becoming a spreadsheet replacement.
- Locking the platform to a specific model vendor.
- Cloud-only operation.
