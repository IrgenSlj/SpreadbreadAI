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

1. **Human-in-the-loop is non-negotiable.** No tool path may mutate a
   workbook without human approval. Enforced in the tool registry, not
   in the prompt.
2. **The platform owns policy, audit, and versioning.** Models are
   replaceable; the platform is the source of truth.
3. **Local-first.** The default install runs fully offline with
   Gemma 4 E2B via Ollama. Cloud models are opt-in.
4. **Model-agnostic.** The LLM adapter exposes one interface; Gemma,
   Qwen, Llama, and cloud providers are interchangeable.
5. **Workbook versions are immutable.** Apply produces a new version;
   it never edits in place.
6. **MCP is the agent integration boundary** — Claude Code, Codex, and
   other clients connect through the same tool catalog the local LLM
   uses.
7. **The sketchpad is deferred** until the core review loop is loved.

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
