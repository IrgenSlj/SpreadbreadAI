# SpreadbreadAI native bundle

Packaging glue that produces a native installer per OS. The user
double-clicks one file and gets a working setup — no Python, no pip,
no terminal.

## What's in the bundle

- A private CPython interpreter shipped with the app (Briefcase
  handles this).
- The `spreadbread-core` daemon (installed as a wheel from `../core`).
- The `spreadbreadai_launcher` package (this directory) — the tray
  app that supervises the daemon and runs first-run setup.
- The compiled `spreadbreadai.oxt` LibreOffice extension as a
  resource, so the launcher can install it via `unopkg add` on first
  run.

## What the user actually does

1. Download `SpreadbreadAI-0.1.x.dmg` / `.msi` / `.AppImage` from a
   GitHub Release.
2. Open it. macOS: drag to Applications. Windows: run the `.msi`.
   Linux: `chmod +x SpreadbreadAI.AppImage && ./SpreadbreadAI.AppImage`.
3. Launch SpreadbreadAI. A tray / menubar icon appears.
4. First run:
   - If Ollama is not installed, the launcher fetches the official
     installer for the OS and runs it.
   - If `gemma4:e2b` is not pulled, `ollama pull` runs in the
     background.
   - The bundled `.oxt` is registered with LibreOffice via `unopkg`.
   - The daemon starts on `127.0.0.1:8765`.
5. Click "Open in LibreOffice Calc" from the tray; the
   **SpreadbreadAI** menu is already there.

## Build flow (developer / CI)

```bash
# from the repo root
cd packaging
pip install briefcase
briefcase create   # one-time: scaffolds platform-specific projects
briefcase build    # compiles / freezes
briefcase package  # produces the native installer
```

CI runs this on macOS, Windows, and Linux runners on every tag push
and uploads the artifacts to the GitHub Release. See
`.github/workflows/release.yml`.

## What's still rough

- The placeholder tray icon is rendered at runtime. Real artwork
  goes into `resources/` and is referenced from `pyproject.toml`.
- Ollama install on macOS uses the .zip flow; the GUI app needs a
  one-time double-click to register the CLI on PATH. We can switch
  to the Homebrew formula path on macOS if the user has Homebrew.
- Windows code signing certificate not yet wired (release builds
  will prompt SmartScreen until that's set up).
- macOS notarization not yet wired (Gatekeeper will warn until that's
  set up).

These are real shipping work but not blockers for an internal beta.
