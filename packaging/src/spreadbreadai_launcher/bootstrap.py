"""First-run setup: Ollama + model + LibreOffice extension auto-install.

Runs every time the launcher starts; each step is a no-op if its work is
already done. The point is that a freshly downloaded `.dmg` / `.msi` /
`.AppImage` should "just work" without the user opening a terminal.
"""
from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import sys
import urllib.request
from importlib import resources
from pathlib import Path

LOG = logging.getLogger("spreadbreadai.bootstrap")

OLLAMA_MAC_INSTALLER = "https://ollama.com/download/Ollama-darwin.zip"
OLLAMA_LINUX_INSTALLER = "https://ollama.com/install.sh"
OLLAMA_WINDOWS_INSTALLER = "https://ollama.com/download/OllamaSetup.exe"
DEFAULT_MODEL = os.environ.get("SPREADBREAD_MODEL", "gemma4:e2b")


def ensure_ollama_and_model() -> None:
    """Idempotent: install Ollama if absent, then pull the default model.

    On a fresh machine this is a one-time multi-GB download. On an
    already-set-up machine it's two `which` checks and a `list` query.
    """
    ollama = shutil.which("ollama")
    if ollama is None:
        LOG.info("Ollama not found; installing")
        _install_ollama()
        ollama = shutil.which("ollama")
        if ollama is None:
            LOG.error("Ollama install completed but binary not on PATH; user must restart")
            return

    try:
        result = subprocess.run([ollama, "list"], capture_output=True, text=True, timeout=15)
    except Exception as exc:
        LOG.warning("could not query Ollama (%s); skipping model pull", exc)
        return
    if DEFAULT_MODEL.split(":")[0] in result.stdout:
        LOG.info("model %s already present", DEFAULT_MODEL)
        return

    LOG.info("pulling model %s — this is a one-time multi-GB download", DEFAULT_MODEL)
    subprocess.Popen([ollama, "pull", DEFAULT_MODEL])  # background; UI shouldn't block


def _install_ollama() -> None:
    system = platform.system().lower()
    try:
        if system == "darwin":
            # Download the .zip, unzip into /Applications, then run the
            # bundled `Ollama.app` once so it registers the CLI binary.
            tmp = Path("/tmp/Ollama-darwin.zip")
            urllib.request.urlretrieve(OLLAMA_MAC_INSTALLER, tmp)
            subprocess.run(["unzip", "-o", str(tmp), "-d", "/Applications"], check=True)
            subprocess.Popen(["open", "/Applications/Ollama.app"])
        elif system == "linux":
            subprocess.run("curl -fsSL %s | sh" % OLLAMA_LINUX_INSTALLER, shell=True, check=True)
        elif system == "windows":
            tmp = Path(os.environ["TEMP"]) / "OllamaSetup.exe"
            urllib.request.urlretrieve(OLLAMA_WINDOWS_INSTALLER, tmp)
            subprocess.run([str(tmp), "/S"], check=True)
        else:
            LOG.error("unsupported platform: %s", system)
    except Exception as exc:
        LOG.error("Ollama install failed: %s", exc)


def ensure_extension_installed() -> None:
    """Install the bundled SpreadbreadAI .oxt into the user's LO config.

    Briefcase will package the .oxt file as a resource of this app at
    build time. We locate it via importlib.resources, then call
    `unopkg add` to register it with the user's LibreOffice profile.
    `unopkg` is shipped with every LibreOffice install.
    """
    unopkg = _find_unopkg()
    if unopkg is None:
        LOG.warning("unopkg not found — install LibreOffice and re-run, or install spreadbreadai.oxt manually")
        return

    try:
        oxt_ref = resources.files("spreadbreadai_launcher").joinpath("spreadbreadai.oxt")
        with resources.as_file(oxt_ref) as oxt_path:
            if not oxt_path.exists():
                LOG.warning(".oxt resource missing from bundle")
                return
            # Idempotent: `unopkg add -f` re-registers if already present.
            subprocess.run([unopkg, "add", "-f", str(oxt_path)], check=True)
            LOG.info("LibreOffice extension installed")
    except Exception as exc:
        LOG.warning("could not install extension: %s", exc)


def _find_unopkg() -> str | None:
    candidates = [
        "unopkg",
        "/Applications/LibreOffice.app/Contents/MacOS/unopkg",
        r"C:\Program Files\LibreOffice\program\unopkg.exe",
        "/usr/bin/unopkg",
        "/usr/lib/libreoffice/program/unopkg",
    ]
    for cmd in candidates:
        if shutil.which(cmd) or Path(cmd).exists():
            return cmd
    return None
