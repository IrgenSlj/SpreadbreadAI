---
name: Bug report
about: Report a defect in the daemon, provider adapters, agent runtime, or apply pipeline
title: "[bug] "
labels: bug
---

## What happened

A clear description of the bug.

## Steps to reproduce

1.
2.
3.

## Expected behavior

What you expected to happen.

## Environment

- OS:
- Python version:
- LibreOffice version (if relevant):
- Provider path: LibreOffice / local xlsx / Google Sheets / MCP / other
- Agent mode: inspect / plan / propose / apply / direct / locked
- Ollama version + model used:
- SpreadbreadAI commit / version:

## Logs / output

```
paste daemon logs, extension messages, or test output here
```

## Workbook details (if relevant)

Sheet count, formula density, anything notable. **Do not attach
workbooks containing real business data.**

## Safety impact

- Did the bug affect staged operations, approval, apply, audit, or
  provider synchronization?
- Did any tool or MCP call perform an action that should have been
  blocked by policy?
