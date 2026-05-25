# UX Principles

SpreadbreadAI should not be chat-only and should not be review-only.
The target UX is:

**conversation-led, artifact-centered, policy-gated.**

## Conversation-Led

Users should be able to start work naturally:

- "Audit this workbook for formula risks."
- "Prepare a month-end variance review."
- "Update this scenario using the new growth assumption."
- "Summarize this spreadsheet into a board-ready report."

The composer can feel like chat, command input, or a workflow launcher.
It is an entry point, not the durable workspace.

## Artifact-Centered

Agent work should become visible objects:

- findings
- proposed operations
- diff cards
- validation results
- dependency impact
- generated reports
- audit timeline
- run summary

Artifacts make the product trustworthy. They let users inspect what the
agent found, what it wants to change, why it wants to change it, and
what happened after approval/apply.

## Policy-Gated

The UI should expose policy without making it feel like bureaucracy.

Modes:

- `inspect` — analyze only.
- `plan` — produce plan and impact.
- `propose` — stage operations.
- `apply` — commit approved operations.
- `direct` — opt-in bounded auto-apply.
- `locked` — strict per-item approval.

The user should always see the current mode, provider, model, and
whether any paid/cloud service is active.

## Primary Layout

Recommended layout for the local artifact UI:

- left: resources/workbooks/documents and run history
- center: artifact board with findings, operations, validation, and output
- right: run timeline, tool calls, audit, and optional chat context
- bottom/top: composer with mode and skill controls

For LibreOffice, this can be compressed into a sidebar:

- summary header
- mode/trust controls
- findings
- proposal/operation cards
- approve/reject/apply actions
- timeline link or compact audit list

## Review Is Conditional

Review is a risk control, not the product identity.

Examples:

- read-only inspection: no approval
- comments: low-risk, optionally auto-stage
- formula edits: approval by default
- broad range edits: stronger approval
- destructive sheet operations: deny until mature
- direct mode: opt-in, bounded, validated, audited

## Cost Visibility

Development and beta UX should make cost obvious:

- local model vs cloud model
- connected provider
- whether API credentials are in use
- token/usage data when available
- estimated cost when available

The default state should be local and free apart from the user's own
machine resources.
