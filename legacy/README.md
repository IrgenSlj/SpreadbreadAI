# Legacy Prototype

This directory holds the original Node + React prototype of SpreadbreadAI.

It is preserved as a reference for the domain model, MCP tool shape, and
review UI behavior during the rewrite. **It is no longer the supported
runtime.** New work happens in `core/` (Python daemon) and `extension/`
(LibreOffice plugin).

See `docs/development-plan.md` for the rewrite plan and migration status.

## Contents

- `apps/web` — the original React + Vite review UI (`App.tsx`, ~5k lines).
- `apps/mcp-server` — Node MCP + HTTP server with file-store and Postgres-store backends.
- `packages/shared` — shared TypeScript domain model. Source of truth for the Python port in `core/spreadbread_core/domain.py`.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` — root Node tooling.

Nothing in this directory is built or tested by the current CI flow.
