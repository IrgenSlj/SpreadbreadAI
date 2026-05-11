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
- packaged release artifacts (`.oxt`, PyPI distributions when published)

Out of scope (report upstream):

- vulnerabilities in LibreOffice itself
- vulnerabilities in Ollama, openpyxl, FastAPI, Pydantic, or other
  third-party dependencies — please report those to their respective
  projects (we will help coordinate where useful)

## Security model reminders

SpreadbreadAI is designed so the LLM cannot write directly to
workbooks. Write tools stage proposal items; in the default `review`
mode, only an explicit human approval can apply them. The opt-in
`direct` mode can auto-approve staged items, but apply is still
performed by the daemon and recorded as a versioned, audited change.
If you find a path that lets an LLM bypass the tool registry or apply
pipeline, treat it as a security issue and report it through the
channel above.

## Local trust assumptions

The default install runs the daemon on `127.0.0.1:8765` and trusts any
process on the local machine to call its API. If you change this — for
example by binding to a non-loopback interface — you must add your own
authentication. Doing so without auth is a configuration vulnerability
on your install.
