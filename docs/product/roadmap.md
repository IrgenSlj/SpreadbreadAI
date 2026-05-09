# Roadmap

This is a high-level view of phases. Detail and rationale live in
[`docs/development-plan.md`](../development-plan.md).

## Now (May 2026)

- Core daemon: domain, store, parser, tools, Ollama loop, FastAPI — landed.
- Tool-calling integration with a local LLM verified end-to-end.
- LibreOffice extension v0.1 (manifest, daemon client, Calc bridge,
  `.oxt` build) — landed.
- Apply pipeline: approved diffs commit a new canonical `.xlsx`
  version, idempotent, audited — landed.

## Next (hardening)

- Conflict detection on apply (refuse when workbook has moved since
  proposal was generated).
- Reorder extension apply so the daemon commits before the Calc bridge
  writes.
- Dedupe cell-reference parsing into a single shared module.
- MCP stdio server so external AI tools (Claude Desktop, Cursor) can
  drive the daemon.
- Trust modes (direct / review / locked) so the workbook owner is not
  forced through staged approval for changes they themselves asked for.

## Later

- Multi-LLM adapter (Gemini, OpenAI, Anthropic) behind one interface.
- Real installer that pulls Python, Ollama, and the chosen model on a
  fresh machine.
- Real sidebar `.ui` panel replacing the v0.1 message-box surface.
- Schema normalization (promote `proposal_items` to its own table;
  Postgres driver) and optimistic concurrency.
- Smarter review: dependency graph, stale-input detection, external
  reference drift, named-range awareness.
- Optional small web review UI for users without LibreOffice.
- Shared-daemon deployment for small teams; reviewer profiles, RBAC,
  scoped access.

## Later

- MCP stdio surface so Claude Code, Codex, and other clients can use
  the same tool catalog.
- Optional small web review UI for users without LibreOffice.
- Excel add-in reusing the same daemon.
- Multi-user deployment behind a Postgres driver.
- Reviewer profiles, RBAC, scoped access.

## Non-goals

- Becoming a spreadsheet replacement.
- Locking the platform to a specific model vendor.
- Cloud-only operation.
