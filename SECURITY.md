# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use [GitHub's private vulnerability reporting][gh] on this repository:

> Security → "Report a vulnerability"

[gh]: https://github.com/IrgenSlj/SpreadbreadAI/security/advisories/new

When reporting, include:

- a description of the issue
- steps to reproduce
- the version or commit you tested against
- the impact you believe the issue has

We aim to acknowledge reports within 72 hours and to ship a fix or
mitigation within 30 days for high-severity issues.

## Scope

In scope:

- the core daemon (`core/`)
- the LibreOffice extension (`extension/`)
- provider adapters and local gateway surfaces as they are added
- skills, MCP tool bridges, and permission policy enforcement
- packaged release artifacts (`.oxt`, PyPI distributions when published)

Out of scope (report upstream):

- vulnerabilities in LibreOffice itself
- vulnerabilities in Ollama, openpyxl, FastAPI, Pydantic, or other
  third-party dependencies — please report those to their respective
  projects (we will help coordinate where useful)

## Security model reminders

SpreadbreadAI is designed so agents cannot write directly to
workbooks or documents. Tools stage typed operations or proposal
items; provider mutation happens through the apply pipeline. In the
default review policy, explicit approval is required before apply. The
opt-in direct/autopilot paths can auto-approve only within configured
policy boundaries, and still route through apply, versioning, and
audit.

If you find a path that lets an LLM, skill, MCP tool, or provider
adapter bypass the tool registry, permission policy, capability
checks, or apply pipeline, treat it as a security issue and report it
through the channel above.

## Local trust assumptions

The default install runs the daemon on `127.0.0.1:8765` and trusts any
process on the local machine to call its API. If you change this — for
example by binding to a non-loopback interface — you must add your own
authentication. Doing so without auth is a configuration vulnerability
on your install.

The development architecture is intentionally single-user and
local-first. Do not expose the daemon, MCP bridge, or future Google
connector to a network without adding authentication, authorization,
and per-user trust boundaries.

Third-party skills and MCP servers are untrusted input. They must be
listed, permission-gated, and auditable before they can influence
write-capable operations.
