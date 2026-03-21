# Local Setup

## Current State

This repository has a working local prototype. You can run the web UI and backend locally to inspect workbook upload, review, approval, and apply flows.

## Planned Local Tooling

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+
- Java 21+ for Apache POI-backed workbook processing

## Expected Services

- `apps/web`
- `apps/mcp-server`
- future workbook processing service

## Local Prototype

Run the backend:

```bash
cd apps/mcp-server && node --import tsx src/http-main.ts
```

Run the web app:

```bash
cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 5173
```

Open:

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:4242/healthz`

## Current Data Layout

- local workbook records and uploads live under `apps/mcp-server/.data/`
- deleting that directory resets the local prototype state
- runtime data is ignored by git
- when `DATABASE_URL` is set, workbook review data is persisted in PostgreSQL instead

## PostgreSQL Mode

Initialize the schema:

```bash
cd apps/mcp-server && DATABASE_URL=postgres://... node --import tsx src/db-init.ts
```

The first schema file is:

- `apps/mcp-server/sql/001_initial_schema.sql`

The runtime store facade will keep using the local file-backed path until `DATABASE_URL` is provided.

## Next Setup Steps

1. migrate or seed review data into PostgreSQL
2. add a dedicated migration command in the workspace toolchain
3. replace the sketchpad placeholder with a real collaborative canvas
4. expand workbook parsing and formula intelligence
5. wire a dedicated workbook processing boundary
