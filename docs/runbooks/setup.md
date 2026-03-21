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

## Next Setup Steps

1. migrate local JSON store data into PostgreSQL
2. add schema validation and request guards to the HTTP API
3. replace the sketchpad placeholder with a real collaborative canvas
4. add workbook cleanup and idempotent apply behavior
5. wire a dedicated workbook processing boundary
