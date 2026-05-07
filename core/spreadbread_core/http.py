"""Local HTTP daemon for the LibreOffice extension and any other client."""
# NOTE: do NOT add `from __future__ import annotations` here. FastAPI / Pydantic
# build schemas eagerly from the route signatures, and stringified ForwardRef
# annotations break body-model resolution (Pydantic raises class-not-fully-defined
# and FastAPI falls back to treating the body as a query param).

import tempfile
from pathlib import Path
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from .apply import ApplyError, apply_proposal
from .config import Config
from .domain import AuditEvent
from .llm import OllamaClient
from .parser import parse_xlsx
from .store import Store
from .tools import ToolRegistry


class ChatRequest(BaseModel):
    message: str


class DecisionRequest(BaseModel):
    decision: str
    reviewer: str
    comment: Optional[str] = None


class ApplyRequest(BaseModel):
    reviewer: str = "user"


class BulkDecisionRequest(BaseModel):
    decision: str = "approve"
    reviewer: str = "user"
    comment: Optional[str] = None


def create_app(config: Optional[Config] = None) -> FastAPI:
    cfg = config or Config.load()
    store = Store(cfg.db_path)
    registry = ToolRegistry(store)
    llm = OllamaClient(cfg.ollama_host, cfg.model, registry)

    app = FastAPI(title="SpreadbreadAI Core", version="0.1.0")

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
        raw = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            wb = parse_xlsx(tmp_path, name=Path(file.filename).stem)
        finally:
            tmp_path.unlink(missing_ok=True)
        store.save_workbook(wb)
        store.save_version_bytes(wb.id, wb.latest_version_id, raw)
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

    @app.post("/api/proposals/{proposal_id}/approve-all")
    def approve_all(proposal_id: str, req: BulkDecisionRequest) -> dict[str, Any]:
        try:
            proposal, flipped = store.decide_all_pending(
                proposal_id, req.decision, req.reviewer, req.comment
            )
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if flipped:
            store.append_audit(
                AuditEvent(
                    workbook_id=proposal.workbook_id,
                    actor=req.reviewer,
                    action=f"proposal.bulk.{req.decision}",
                    detail=f"{req.reviewer} {req.decision}d {len(flipped)} pending item(s) on {proposal_id}",
                )
            )
        return {"proposal": proposal.model_dump(), "flipped_item_ids": flipped}

    @app.post("/api/proposals/{proposal_id}/apply")
    def apply(proposal_id: str, req: ApplyRequest) -> dict[str, Any]:
        try:
            result = apply_proposal(store, proposal_id, reviewer=req.reviewer)
        except ApplyError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "proposal": result.proposal.model_dump(),
            "version": result.version.model_dump(),
            "applied_item_ids": result.applied_item_ids,
        }

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
