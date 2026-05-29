# UI/UX Redesign — Prompt for Claude Design

## Product

SpreadbreadAI is an open-source local-first agentic workspace for
spreadsheet and document work. Users upload or create workbooks, chat
with an AI agent in different modes (inspect/plan/propose/apply/direct/locked),
review findings and proposed operations, approve/reject changes, and apply
them through an audited pipeline.

The current prototype at `http://127.0.0.1:8765/ui/` is a functional but
bare single‑page HTML app. It needs a proper design.

## Core UX Contract

The design principle is: **conversation-led, artifact-centered,
policy-gated**.

- Chat starts the work.
- Artifacts (findings, operations, timeline, dependency impact) are the
  durable objects that users inspect, approve, and act on.
- Policy (mode, trust level) decides what the agent can do.

## Current UI Structure

```
┌─────────────────────────────────────────────────┐
│ Sidebar (280px)           │ Main area (flex 1)  │
│                           │                     │
│ Header: SpreadbreadAI     │ Chat / Artifact     │
│                           │ panel (toggle)      │
│ [Upload] [+ New]          │                     │
│ [Delete current]          │                     │
│                           │                     │
│ Workbooks list            │                     │
│  ─ workbook (active)      │                     │
│  ─ workbook               │                     │
│                           │                     │
│ Runs list                 │                     │
│  ─ run_id … mode · status │                     │
│  ─ run_id … mode · status │                     │
│                           │                     │
├─────────────────────────────────────────────────┤
│ Toolbar: Trust: [badge] [select] │ [Artifacts]  │
│         [Approve all] [Apply] [Clear chat]      │
├─────────────────────────────────────────────────┤
│ [mode select] [________________________] [Send] │
└─────────────────────────────────────────────────┘
```

## All Existing Buttons & Controls

Each has its JS function name and API call:

| UI Element | Function | API Call |
|---|---|---|
| Upload workbook | `uploadWorkbook()` | `POST /api/workbooks/upload` (multipart) |
| + New workbook | `createWorkbook()` | `POST /api/workbooks/create {"name":"..."}` |
| Delete current workbook | `deleteWorkbook()` | `DELETE /api/workbooks/{id}` |
| Workbook list item (click) | `selectWorkbook(wb)` | `GET /api/workbooks` (list) |
| Run list item (click) | `selectRun(run)` | `GET /api/runs/{id}/artifacts` |
| Chat send | `sendMessage(e)` | `POST /api/workbooks/{id}/chat {"message","mode"}` |
| Mode select (in chat bar) | (form field) | sent in chat body |
| Trust mode select (toolbar) | `changeTrustMode()` | `POST /api/workbooks/{id}/trust-mode {"mode"}` |
| Toggle Chat/Artifacts | `toggleArtifacts()` | (client-side toggle) |
| Approve all | `approveAll()` | `POST /api/proposals/{id}/approve-all` |
| Apply | `applyProposal()` | `POST /api/proposals/{id}/apply` |
| Per-item Approve | `decideItem(propId,opId,'approve',btn)` | `POST /api/proposals/{id}/items/{itemId}/decision` |
| Per-item Reject | `decideItem(propId,opId,'reject',btn)` | same endpoint |
| Clear chat | `clearChat()` | (client-side) |

## Artifact Data Structure

Each run returns this JSON from `GET /api/runs/{id}/artifacts`:

```json
{
  "run_id": "run_abc123",
  "workbook_id": "wb_def456",
  "workbook_name": "Budget 2026",
  "latest_proposal_id": "prop_xyz789",
  "prompt": "inspect this workbook",
  "mode": "inspect",
  "model": "gemma4:e2b",
  "status": "completed",
  "started_at": "2026-05-29T...",
  "completed_at": "2026-05-29T...",
  "summary": "Found 3 risks and 2 proposed changes.",
  "findings": [
    {
      "id": "risk_...",
      "severity": "high",
      "location": "Sheet1!D12",
      "summary": "External reference to [budget.xlsx]",
      "detail": "External ref"
    }
  ],
  "operations": [
    {
      "id": "op_...",
      "kind": "set_cell_formula",
      "target": "Sheet1!D12",
      "before": "=B12*C12",
      "after": "=B12*$C$3",
      "rationale": "Use shared margin assumption",
      "risk": "medium",
      "status": "pending",
      "validation": "valid"
    }
  ],
  "timeline": [
    {
      "id": "evt_...",
      "kind": "tool_call",
      "detail": "LLM called inspect_sheet",
      "created_at": "2026-05-29T...",
      "payload": {}
    }
  ],
  "dependency_impact": [
    {
      "cell": "D12",
      "dependents": ["E12", "F12"]
    }
  ],
  "tool_calls": 5,
  "proposals_created": 1,
  "items_decided": 0
}
```

## What Already Works (Don't Break)

- **Dark mode**: follows `prefers-color-scheme: dark` via CSS variables
- **All API calls**: use a single `api(method, path, body)` fetch wrapper
- **Escaping**: `esc(s)` function for safe HTML rendering
- **Spinner**: CSS `.spinner` class for loading states
- **Single file**: everything lives in one HTML file, no build step
- **Backend**: FastAPI on `127.0.0.1:8765`, all paths are absolute (`/api/...`)

## What We Want Back

Produce a **single `index.html`** file that replaces the current one.
It must:

1. **Keep all existing functions and API contracts** named exactly as above
   — the new HTML can reorganize the layout but the JS functions must
   remain callable from the new UI (you can rename internal variables but
   not the exported function names).

2. **Be a single self-contained HTML file** — all CSS in `<style>`, all JS
   in `<script>`, no external dependencies, no CDN, no build step.

3. **Look professional and modern** — think Linear, Notion, or Superhuman
   level of fit and finish. Clean typography, subtle shadows, good
   spacing, smooth transitions.

4. **Improve the information hierarchy**:
   - Chat and artifacts should feel like two views of the same workspace,
     not a clunky toggle
   - Findings, operations with approve/reject, timeline, and dependency
     impact should each have clear visual identity
   - The run selector should show enough context (prompt snippet, time,
     mode, status) to be useful

5. **Polish all interactions**:
   - Hover states, focus rings, loading skeletons or spinners
   - Disabled button states during API calls
   - Toast or inline notifications instead of `alert()`
   - Keyboard shortcuts where natural (Enter to send, Escape to close)

6. **Keep dark mode** with same `prefers-color-scheme: dark` approach.

## Design Constraints

- Sidebar should feel like a navigation panel, not a crowded list
- The chat area is the primary working surface; artifacts are secondary
  but must be easy to reach
- Mode and trust controls should be visible but not prominent
- Operation cards need clear approve/reject affordances
- The app runs at a localhost URL — no auth UI, no cloud chrome
- Responsive down to 900px width; below that the sidebar collapses

## Deliverable

A single, complete `index.html` file with:

- Full `<style>` block (organized, commented sections)
- Full HTML structure (semantic, accessible)
- Full `<script>` block (keep all existing function names, improve code
  organization if desired)

Do not change any API paths or function signatures. The backend stays
exactly as it is.

## File To Replace

`core/spreadbread_core/static/index.html` (495 lines currently)
