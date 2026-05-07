"""Local HTTP daemon for the LibreOffice extension and any other client."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from .config import Config
from .domain import AuditEvent
from .llm import OllamaClient
from .parser import parse_xlsx
from .store import Store
from .tools import ToolRegistry


def create_app(config: Config | None = None) -> FastAPI:
    cfg = config or Config.load()
    store = Store(cfg.db_path)
    registry = ToolRegistry(store)
    llm = OllamaClient(cfg.ollama_host, cfg.model, registry)

    app = FastAPI(title="SpreadbreadAI Core", version="0.1.0")

    class ChatRequest(BaseModel):
        message: str

    class DecisionRequest(BaseModel):
        decision: str
        reviewer: str
        comment: str | None = None

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {"ok": True, "model": cfg.model, "tools": [t.name for t in registry.list_tools()]}

    @app.get("/api/workbooks")
    def list_workbooks() -> list[dict[str, Any]]:
        return [wb.model_dump() for wb in store.list_workbooks()]

    @app.post("/api/workbooks/upload")
    async def upload(file: UploadFile = File(...)) -> dict[str, Any]:
        if not file.filename:
            raise HTTPException(400, "filename required")
        suffix = Path(file.filename).suffix or ".xlsx"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = Path(tmp.name)
        try:
            wb = parse_xlsx(tmp_path, name=Path(file.filename).stem)
        finally:
            tmp_path.unlink(missing_ok=True)
        store.save_workbook(wb)
        store.append_audit(
            AuditEvent(
                workbook_id=wb.id,
                actor="user",
                action="workbook.uploaded",
                detail=f"Uploaded {file.filename} ({len(wb.sheets)} sheets)",
            )
        )
        return wb.model_dump()

    @app.get("/api/workbooks/{workbook_id}/review")
    def review(workbook_id: str) -> dict[str, Any]:
        snap = store.review_snapshot(workbook_id)
        if not snap:
            raise HTTPException(404, "workbook not found")
        return snap.model_dump()

    @app.post("/api/workbooks/{workbook_id}/chat")
    def chat(workbook_id: str, req: ChatRequest) -> dict[str, Any]:
        if not store.get_workbook(workbook_id):
            raise HTTPException(404, "workbook not found")
        message = f"Workbook id: {workbook_id}\nUser request: {req.message}"
        result = llm.chat(message)
        return {
            "reply": result.final_message,
            "rounds": result.rounds,
            "tool_calls": result.tool_calls,
        }

    @app.post("/api/proposals/{proposal_id}/items/{item_id}/decision")
    def decide(proposal_id: str, item_id: str, req: DecisionRequest) -> dict[str, Any]:
        proposal = store.decide_item(proposal_id, item_id, req.decision, req.reviewer, req.comment)
        store.append_audit(
            AuditEvent(
                workbook_id=proposal.workbook_id,
                actor=req.reviewer,
                action=f"proposal.item.{req.decision}",
                detail=f"{req.reviewer} {req.decision}d item {item_id}",
            )
        )
        return proposal.model_dump()

    @app.get("/api/tools")
    def tools() -> list[dict[str, Any]]:
        return registry.to_ollama_schema()

    return app


def main() -> None:
    cfg = Config.load()
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="info")


if __name__ == "__main__":
    main()
