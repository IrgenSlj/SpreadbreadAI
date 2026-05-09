# ADR 0001: Architecture Principles

## Status

Accepted.

## Context

SpreadbreadAI must remain open-source, work offline on free local LLMs,
support spreadsheet-heavy business workflows, and integrate with
external AI agents without delegating policy enforcement to them. After
an initial Node + React prototype, the product is being rebuilt as a
LibreOffice Calc plugin backed by a local Python daemon.

## Decisions

1. Human-in-the-loop approval is enforced at the tool registry, not
   in the prompt. Write tools stage proposal items only; `apply` is
   the single code path that mutates workbook state and requires
   approved items.
2. The platform owns policy, audit, and versioning. Models are
   replaceable; the platform is the system of record.
3. Local-first by default. The default install runs fully offline
   using Ollama with Gemma 4 E2B. Cloud LLMs are opt-in.
4. Model-agnostic LLM layer. The adapter exposes one interface so
   Gemma, Qwen, Llama, and cloud providers are interchangeable.
5. Workbook versions are immutable. `apply` produces a new version;
   it never edits in place.
6. MCP is the integration boundary for external AI clients. Claude
   Desktop, Cursor, VS Code agents, and Codex connect through the
   same tool catalog the local LLM uses.
7. The sketchpad is deferred until the core review and apply loop is
   stable and adopted.

## Consequences

- Approval and audit are first-class concerns from day one.
- The product can ship fully offline on commodity hardware.
- Implementation complexity sits in the daemon, not in the extension or
  the model.
- The platform stays portable: the same daemon can power the LO
  extension, an Excel add-in, an MCP client, or a web review UI.

## Superseded sections

The original ADR predated the LibreOffice pivot and assumed a Node /
React stack. The principles above are the current canonical version.
