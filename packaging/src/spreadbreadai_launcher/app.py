"""Tray app that supervises the daemon.

Why this exists: end users should not have to run `spreadbread-core` in
a terminal. They click the bundled app, it shows a tray icon, the
daemon runs as a child of that icon's process. Quitting via the tray
menu cleanly shuts down the daemon. Crashing the tray restarts the
daemon. Closing the user session stops everything.

The actual app logic (HTTP, SQLite, LLM, apply) all lives in the
daemon — this file is glue.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional

import httpx
from PIL import Image, ImageDraw
from pystray import Icon, Menu, MenuItem

from .bootstrap import ensure_extension_installed, ensure_ollama_and_model

LOG = logging.getLogger("spreadbreadai.launcher")
DAEMON_HEALTHZ = "http://127.0.0.1:8765/healthz"
DAEMON_PORT = 8765


def _icon_image() -> Image.Image:
    """Render a placeholder tray icon. Replaced by the proper artwork at
    build time; this is the runtime fallback."""
    img = Image.new("RGBA", (64, 64), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((4, 4, 60, 60), fill=(40, 110, 60, 255))
    draw.text((20, 20), "SB", fill="white")
    return img


class DaemonSupervisor:
    """Runs `spreadbread-core` as a subprocess and restarts it on crash."""

    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.proc: Optional[subprocess.Popen] = None
        self._stop = threading.Event()

    def start(self) -> None:
        if self.proc and self.proc.poll() is None:
            return
        log = self.log_path.open("ab", buffering=0)
        # We invoke the daemon via the same Python that's running this
        # launcher so the bundled environment is used. spreadbread-core
        # is installed as a console script, so the import path is
        # spreadbread_core.http:main.
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "spreadbread_core.http"],
            stdout=log,
            stderr=log,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        LOG.info("daemon started, pid=%s", self.proc.pid)

    def stop(self) -> None:
        self._stop.set()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            LOG.info("daemon stopped")

    def is_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def watch_loop(self) -> None:
        """Background thread: restart the daemon if it dies."""
        while not self._stop.is_set():
            if not self.is_alive():
                LOG.warning("daemon exited; restarting in 2s")
                time.sleep(2)
                if not self._stop.is_set():
                    self.start()
            time.sleep(1)


def _wait_for_daemon(timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            httpx.get(DAEMON_HEALTHZ, timeout=1.0)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def _data_dir() -> Path:
    """User-writable data dir, OS-appropriate."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SpreadbreadAI"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home())) / "SpreadbreadAI"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "SpreadbreadAI"


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    data = _data_dir()
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SPREADBREAD_DATA_DIR", str(data / "data"))
    log_path = data / "daemon.log"

    # First-run setup. These are no-ops if already done.
    ensure_ollama_and_model()
    ensure_extension_installed()

    supervisor = DaemonSupervisor(log_path)
    supervisor.start()
    if not _wait_for_daemon():
        LOG.error("daemon failed to start within 30s; check %s", log_path)

    threading.Thread(target=supervisor.watch_loop, daemon=True).start()

    def on_open_calc(icon, item):
        # Best-effort launch of LibreOffice Calc. The plugin auto-installs.
        for cmd in ("soffice", "libreoffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
            if shutil.which(cmd) or Path(cmd).exists():
                subprocess.Popen([cmd, "--calc"])
                return

    def on_open_logs(icon, item):
        webbrowser.open(f"file://{log_path}")

    def on_open_data(icon, item):
        webbrowser.open(f"file://{data}")

    def on_restart(icon, item):
        supervisor.stop()
        supervisor.start()

    def on_quit(icon, item):
        supervisor.stop()
        icon.stop()

    menu = Menu(
        MenuItem("Open in LibreOffice Calc", on_open_calc),
        MenuItem("Show daemon logs", on_open_logs),
        MenuItem("Show data folder", on_open_data),
        Menu.SEPARATOR,
        MenuItem("Restart daemon", on_restart),
        MenuItem("Quit SpreadbreadAI", on_quit),
    )
    Icon("SpreadbreadAI", _icon_image(), "SpreadbreadAI", menu).run()
    return 0
