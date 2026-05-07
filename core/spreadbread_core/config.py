from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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
        root = Path(os.environ.get("SPREADBREAD_DATA_DIR", Path(__file__).resolve().parents[2] / "core" / ".data"))
        root.mkdir(parents=True, exist_ok=True)
        return cls(
            data_dir=root,
            db_path=root / "spreadbread.sqlite3",
            ollama_host=os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"),
            model=os.environ.get("SPREADBREAD_MODEL", "gemma4:e2b"),
            host=os.environ.get("SPREADBREAD_HOST", "127.0.0.1"),
            port=int(os.environ.get("SPREADBREAD_PORT", "8765")),
        )
