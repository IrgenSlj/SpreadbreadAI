from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


def _default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SpreadbreadAI" / "data"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home())) / "SpreadbreadAI" / "data"
    return (
        Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
        / "spreadbreadai"
        / "data"
    )


@dataclass(frozen=True)
class Config:
    data_dir: Path
    db_path: Path
    ollama_host: str
    model: str
    host: str
    port: int

    @classmethod
    def load(cls) -> "Config":
        root = Path(os.environ.get("SPREADBREAD_DATA_DIR", _default_data_dir()))
        root.mkdir(parents=True, exist_ok=True)
        return cls(
            data_dir=root,
            db_path=root / "spreadbread.sqlite3",
            ollama_host=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"),
            model=os.environ.get("SPREADBREAD_MODEL", "gemma4:e2b"),
            host=os.environ.get("SPREADBREAD_HOST", "127.0.0.1"),
            port=int(os.environ.get("SPREADBREAD_PORT", "8765")),
        )
