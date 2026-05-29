# Product Requirements Document

## Product

SpreadbreadAI is an open-source, local-first agentic workspace for
complex spreadsheet and document work. It gives users AI help for
analysis, cleanup, formula review, scenario modeling, and report
generation while preserving provider control, versioning, and audit.

The current product ships as a LibreOffice Calc extension plus a local
Python daemon. LibreOffice/local xlsx remains the first provider path.
The product direction is provider-neutral: Google Sheets next, Google
Docs and Excel later.

## Positioning

SpreadbreadAI is the expert agent layer above office documents. It is
not a spreadsheet replacement and not a generic chatbot. Users can ask
for work in natural language, but the app turns that work into
structured artifacts: findings, proposed operations, diffs, validation
results, dependency impact, and audit events.

The UX principle is:

**conversation-led, artifact-centered, policy-gated.**

Chat starts the work. Artifacts hold the work. Policy decides whether
the work can be applied automatically, needs review, or is blocked.

## Target Users

- FP&A analysts and finance managers
- finance operations, revenue operations, procurement, and planning teams
- operators who maintain large spreadsheets across repeated business cycles
- document-heavy teams that need AI-assisted reports with traceable changes
- technically capable users who want local-first AI with MCP and skills

## Primary User Problems

- Spreadsheet logic is hard to review and easy to break.
- Changes across formulas, references, named ranges, and scenarios are
  hard to trace.
- Generic AI copilots do not provide strong enough controls for
  business-critical workbooks.
- Chat-only AI loses the actual work inside a transcript.
- Cloud-only AI is unsuitable for sensitive finance and operations data.
- Teams want automation, but they need a clear record of what changed,
  why, by which tool/model, and under which policy.

## Product Principles

- Local-first and low-cost by default.
- Provider-neutral core; provider-specific adapters at the edge.
- Agents use declared tools and capabilities only.
- Typed operations precede provider mutation.
- Review is risk-based, not universal friction.
- Skills teach workflows; tools perform actions.
- MCP integrations are permission-gated and audited.
- SQLite/local files remain the default until multi-user demand is real.

## MVP Scope

### In scope now

- LibreOffice Calc extension with local daemon integration.
- Local Python daemon owning workbooks, proposals, versions, and audit.
- xlsx parsing: sheet metadata, formulas, risks, named ranges,
  dependencies, and reference issues.
- LLM tool calling against a fixed catalog.
- Write staging, approval, apply, conflict checks, immutable versions,
  and audit trail.
- MCP stdio server exposing the same tool registry.
- Offline operation with Ollama/Gemma as the default.

### Done since initial MVP

- Explicit agent modes: inspect, plan, propose, apply, and bounded direct
  (wired in `/chat` and `/api/tools`; UI affordances still pending).
- Operation IR: standalone `operations` table, lifecycle CRUD, HTTP API,
  sync from proposal item decisions.
- Provider capability model: `ProviderCapabilities` dataclass,
  `ProviderAdapter` ABC, lazy registry (`get_provider`, `register_provider`).
- Google Sheets adapter: Sheets API v4 read/write, OAuth, mocked tests,
  registered in provider registry.
- Run/session tracing: `run_events` table, tool-call recording, event API.
- Gemini cloud LLM adapter (opt-in, mocked in tests).
- Validators: circular-ref and broken-sheet-ref pre-apply validation.
- Eval harness: 4 synthetic workbooks, 7 cases, offline + LLM-gated.

### Still to do

- Artifact-centered UI surface for findings, proposed operations,
  validation, dependency impact, and audit timeline.
- Skills registry using local `SKILL.md`-style workflow packs.
- Explicit permission policy returning `allow`, `ask`, `deny`.

### Out of scope for the development/beta phase

- Multi-tenant cloud deployment.
- Postgres requirement for the default path.
- Plugin marketplace.
- Large agent hierarchies or manager-of-agents frameworks.
- Cloud sync as a required dependency.
- Autonomous high-risk writes without policy, validation, and audit.
- Replacing Google Sheets, LibreOffice, or Excel.

## Core User Stories

1. As an analyst, I ask SpreadbreadAI to inspect a workbook and receive
   structured findings with locations, severity, and source context.
2. As a finance manager, I ask for a scenario update and see proposed
   operations before anything is changed.
3. As an approver, I review high-risk formula changes as diff cards and
   approve or reject them one at a time.
4. As a power user, I run a repeatable skill such as month-end review,
   formula audit, or report generation.
5. As an MCP user, I let an external agent inspect a workbook while the
   daemon still enforces permissions and audit.
6. As a privacy-conscious user, I run the stack offline with a local
   model and SQLite.
7. As a Google Sheets user, I connect one spreadsheet and get the same
   findings, operation proposals, and audit flow without changing the
   core engine.

## Agent Modes

- `inspect` — read-only analysis and findings.
- `plan` — read-only task plan and impact estimate.
- `propose` — creates typed operations/proposal items, no provider writes.
- `apply` — commits approved or trusted operations through the provider adapter.
- `direct` — opt-in bounded auto-apply for low-risk or explicitly trusted tasks.
- `locked` — strict mode requiring per-item approval for write operations.

## Success Metrics

- Workbook review time reduced by at least 50% on repeated workflows.
- Broken formulas, missing references, stale inputs, or external-link
  risks detected before a close/reporting cycle.
- A complete local demo runs offline on commodity hardware.
- Zero unapproved high-risk writes through agent, skill, or MCP paths.
- Users can trace one run from prompt to tools, proposal, approval,
  apply, version, and audit.
- At least one repeatable skill becomes useful enough for weekly/monthly reuse.

## Differentiation

- Artifact-first agent UX for spreadsheets and documents, not chat-only.
- Typed operations and provider adapters instead of direct prompt-to-document edits.
- Local-first default with optional cloud models.
- MCP and skills as integration/workflow layers, not bypasses around policy.
- Immutable versions and audit as core product objects.
- Spreadsheet-specific intelligence: formulas, dependencies, named ranges,
  external references, stale markers, and provider capability awareness.

## Risks

- Broad provider ambitions could turn the project into an unfinished platform.
- LibreOffice UNO UI work can consume time without improving the core engine.
- Local small models may be weak at precise cell reasoning.
- Google/Office integrations can introduce OAuth and API complexity early.
- JSON payload storage will limit queryability as artifacts and runs grow.
- A chat-first UI could bury the artifacts that make the app trustworthy.

## Mitigations

- Finish the local Calc loop and operation IR before adding Google.
- Keep the extension thin; daemon APIs own behavior.
- Add deterministic spreadsheet tools before relying on larger models.
- Make cloud providers and Google connectors opt-in with user-supplied keys.
- Normalize only the tables needed for runs, operations, and artifacts first.
- Treat review as policy, not the primary UX.

## Beta Exit Criteria

- Calc and MCP both drive the same daemon-owned workflow.
- Agent modes are explicit and permission-gated.
- Proposed changes are represented as typed operations/proposal items.
- Findings, operations, validation, and audit are visible as artifacts.
- Apply remains idempotent and audited.
- Default install still runs offline with Ollama and SQLite.
- No required cloud service, hosted queue, vector DB, Postgres server, or
  plugin runtime is introduced.
