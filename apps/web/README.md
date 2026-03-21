# Web App

`apps/web` is the review-first frontend for SpreadbreadAI.

It is structured around four primary surfaces:

- workbook review
- proposal review
- audit timeline
- sketchpad

## Run

From the repository root, install dependencies and start the app with the workspace toolchain you prefer. This package is configured for Vite, React, and TypeScript.

For the local prototype:

```bash
cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/`.

## Scope

The current UI supports workbook review, proposal review, audit history, and a placeholder sketchpad. The next phase is to harden mutation flows, replace the placeholder canvas, and support stronger approval semantics.
