"""Entry point for the bundled app.

When a user double-clicks SpreadbreadAI.app / SpreadbreadAI.exe, this
runs. Responsibilities:

1. First-run check: is Ollama installed? Is the default model pulled?
   If not, fetch them with progress.
2. Locate or install the LibreOffice extension (.oxt) into the user's
   LO extensions directory.
3. Start the daemon as a child process (so the tray app owns its
   lifetime — closing the tray menu shuts down the daemon).
4. Show a tray / menubar icon with: Open Calc, Open Logs, Restart
   Daemon, Quit.
"""
from __future__ import annotations

import sys

from .app import run


def main() -> int:
    return run()


if __name__ == "__main__":
    sys.exit(main())
