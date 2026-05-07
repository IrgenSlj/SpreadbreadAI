# Product Requirements Document

## Product

SpreadbreadAI — open-source, human-in-the-loop AI review for
spreadsheets, delivered as a LibreOffice Calc plugin backed by a local
daemon and free LLMs.

## Positioning

A governed AI review surface that lives where finance users already
work. The model can read the workbook, list risks, and stage proposed
changes; humans approve every write.

## Target Users

- FP&A analysts and finance managers
- finance operations teams
- revenue operations and procurement teams that own large workbooks

## Primary User Problems

- workbook logic is hard to review and easy to break
- spreadsheet changes are hard to trace and approve
- formula and reference errors are common and expensive
- generic AI copilots are not trusted to write to business-critical
  workbooks
- cloud-only AI tooling is a non-starter for finance data in many orgs

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

- approval-first AI workflow that lives inside the spreadsheet
- workbook diff and lineage as first-class product concepts
- works fully offline on free local LLMs
- model-agnostic — local Gemma / Qwen / Llama or cloud Claude / GPT /
  Gemini, swappable in one setting

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
