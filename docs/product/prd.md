# Product Requirements Document

## Product

SpreadbreadAI is an open-source spreadsheet AI assistant for
enterprise and professional use. It pairs agentic LLM tool calling
with human-in-the-loop approval, immutable workbook versioning, and an
append-only audit trail. Delivered as a LibreOffice Calc plugin and a
local Python daemon, with MCP support for external AI clients.

## Positioning

An agentic spreadsheet assistant that reviewers and operators can
trust with business-critical workbooks. The LLM works inside a defined
tool catalog: it inspects sheets, lists risks, and stages proposed
edits. Humans approve changes; the daemon writes a new versioned copy
of the workbook and records every step.

## Target Users

- FP&A analysts and finance managers
- finance operations teams
- revenue operations and procurement teams that own large workbooks

## Primary User Problems

- Workbook logic is hard to review and easy to break.
- Spreadsheet changes are hard to trace and approve at scale.
- Formula and reference errors are common and expensive.
- Generic AI copilots offer no controls strong enough for
  business-critical workbooks.
- Cloud-only AI tooling is unsuitable for finance and operations data
  in regulated organizations.

## MVP Scope

### In scope

- LibreOffice Calc plugin with a review sidebar
- local Python daemon owning workbooks, proposals, diffs, and audit
- xlsx parsing: sheet metadata, formulas, sample rows, seeded risks
- LLM tool calling against a fixed catalog (read + staged-write)
- diff cards: cell, before, after, rationale, approve/reject
- apply pipeline: write approved diffs into a new workbook version
- append-only audit trail for every state transition
- offline operation with Gemma 4 E2B via Ollama as the default model

### Out of scope (for the MVP)

- Excel add-in (Calc first; Excel comes after the loop is loved)
- full formula recalculation engine — Calc / Excel evaluate
- a custom DSL or query language
- multi-tenant cloud deployment
- autonomous AI execution without approval

## Success Metrics

- workbook review time cut by at least 50%
- broken formulas, missing references, or stale inputs detected before
  close
- repeat usage on weekly or monthly close cycles
- zero unapproved AI writes to protected workbooks
- the full demo runs offline on a laptop with 8 GB RAM

## Core User Stories

1. As a finance manager, I open a workbook in Calc, click "Review with
   SpreadbreadAI," and see a structured list of risks and proposed
   changes drafted by a local model.
2. As an analyst, I ask the AI to draft a scenario update; the
   proposal appears in the sidebar without touching the workbook.
3. As an approver, I review each diff card and approve or reject it
   one at a time.
4. As an operator, I see a complete audit trail of who proposed what,
   when, and which model produced it.
5. As a privacy-conscious user, I run the entire stack offline with
   Gemma 4 E2B; no data leaves my machine.

## Differentiation

- Agentic LLM tool calling combined with explicit approval and an
  immutable audit trail.
- Workbook diffs and version lineage are first-class objects, not
  dressed-up chat history.
- Runs fully offline on a free local model by default.
- Model-agnostic LLM layer: local Gemma / Qwen / Llama or cloud
  Claude / GPT / Gemini, swappable through the adapter.
- MCP server lets users' existing AI tools (Claude Desktop, Cursor,
  VS Code) drive the same workflow.

## Risks

- LibreOffice UNO API friction
- 2B-class local models hallucinating cell references — mitigated by
  staging-only writes and cell-existence validation in the registry
- Excel parity expectation arriving immediately — mitigated by keeping
  the daemon format-agnostic from day one
- distribution surface (extension, daemon, Ollama, model files)

## MVP Exit Criteria

- one finance review workflow runs end-to-end inside LibreOffice Calc
- daemon, extension, and a local model run fully offline
- approval state machine is canonical and enforced in the daemon
- audit trail covers upload, proposal creation, every item decision,
  and apply
- a packaged `.oxt` and a `pipx`-installable daemon are available
