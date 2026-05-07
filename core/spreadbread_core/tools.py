"""Tool registry exposed to the LLM.

Every callable here is a tool the model can invoke through Ollama's
tool-calling protocol. Write tools enqueue proposal items for human
approval — they never mutate workbooks directly.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .domain import (
    AuditEvent,
    DiffKind,
    Proposal,
    ProposalItem,
    new_proposal,
)
from .store import Store


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]
    write: bool = False


class ToolRegistry:
    def __init__(self, store: Store):
        self.store = store
        self._tools: dict[str, Tool] = {}
        self._register_builtins()

    # --- public API ----------------------------------------------------
    def list_tools(self) -> list[Tool]:
        return list(self._tools.values())

    def to_ollama_schema(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in self._tools.values()
        ]

    def call(self, name: str, arguments: dict[str, Any]) -> Any:
        if name not in self._tools:
            raise KeyError(f"unknown tool: {name}")
        return self._tools[name].handler(**(arguments or {}))

    # --- registration --------------------------------------------------
    def _add(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def _register_builtins(self) -> None:
        self._add(
            Tool(
                name="list_workbooks",
                description="List every workbook the user has uploaded. Returns id, name, owner, status.",
                parameters={"type": "object", "properties": {}, "required": []},
                handler=self._list_workbooks,
            )
        )
        self._add(
            Tool(
                name="get_review_snapshot",
                description="Get the full review snapshot for a workbook: sheets, risks, latest proposal, audit trail.",
                parameters={
                    "type": "object",
                    "properties": {"workbook_id": {"type": "string"}},
                    "required": ["workbook_id"],
                },
                handler=self._get_review_snapshot,
            )
        )
        self._add(
            Tool(
                name="inspect_sheet",
                description="Inspect a single sheet: dimensions, formula count, sample rows.",
                parameters={
                    "type": "object",
                    "properties": {
                        "workbook_id": {"type": "string"},
                        "sheet_name": {"type": "string"},
                    },
                    "required": ["workbook_id", "sheet_name"],
                },
                handler=self._inspect_sheet,
            )
        )
        self._add(
            Tool(
                name="list_risks",
                description="List risks detected on a workbook (formula chains, stale inputs, reference drift).",
                parameters={
                    "type": "object",
                    "properties": {"workbook_id": {"type": "string"}},
                    "required": ["workbook_id"],
                },
                handler=self._list_risks,
            )
        )
        self._add(
            Tool(
                name="propose_diff",
                description=(
                    "Stage a single cell change for human review. Does NOT modify the workbook. "
                    "An approver must accept the item before it can be applied."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "workbook_id": {"type": "string"},
                        "cell": {"type": "string", "description": "e.g. Forecast!G18"},
                        "kind": {"type": "string", "enum": ["add", "remove", "update", "comment"]},
                        "after": {"type": "string"},
                        "before": {"type": "string"},
                        "rationale": {"type": "string"},
                    },
                    "required": ["workbook_id", "cell", "kind", "rationale"],
                },
                handler=self._propose_diff,
                write=True,
            )
        )
        self._add(
            Tool(
                name="add_comment",
                description="Attach reviewer commentary to a cell as a proposal comment item (still requires approval).",
                parameters={
                    "type": "object",
                    "properties": {
                        "workbook_id": {"type": "string"},
                        "cell": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["workbook_id", "cell", "body"],
                },
                handler=self._add_comment,
                write=True,
            )
        )

    # --- handlers ------------------------------------------------------
    def _list_workbooks(self) -> list[dict[str, Any]]:
        return [
            {"id": wb.id, "name": wb.name, "owner": wb.owner, "status": wb.status, "sheets": len(wb.sheets)}
            for wb in self.store.list_workbooks()
        ]

    def _get_review_snapshot(self, workbook_id: str) -> dict[str, Any]:
        snap = self.store.review_snapshot(workbook_id)
        if not snap:
            raise KeyError(f"workbook {workbook_id} not found")
        return snap.model_dump()

    def _inspect_sheet(self, workbook_id: str, sheet_name: str) -> dict[str, Any]:
        wb = self.store.get_workbook(workbook_id)
        if not wb:
            raise KeyError(f"workbook {workbook_id} not found")
        for sheet in wb.sheets:
            if sheet.name == sheet_name:
                return sheet.model_dump()
        raise KeyError(f"sheet {sheet_name} not found in {workbook_id}")

    def _list_risks(self, workbook_id: str) -> list[dict[str, Any]]:
        wb = self.store.get_workbook(workbook_id)
        if not wb:
            raise KeyError(f"workbook {workbook_id} not found")
        return [r.model_dump() for r in wb.risks]

    def _ensure_proposal(self, workbook_id: str) -> Proposal:
        proposal = self.store.latest_proposal_for(workbook_id)
        if proposal and proposal.status in ("draft", "pending_approval"):
            return proposal
        proposal = new_proposal(
            workbook_id=workbook_id,
            title="AI review draft",
            summary="Automated review proposal pending human approval.",
            requested_by="llm",
        )
        self.store.save_proposal(proposal)
        self.store.append_audit(
            AuditEvent(
                workbook_id=workbook_id,
                actor="llm",
                action="proposal.created",
                detail=f"Created proposal {proposal.id}",
            )
        )
        return proposal

    def _propose_diff(
        self,
        workbook_id: str,
        cell: str,
        kind: DiffKind,
        rationale: str,
        after: str | None = None,
        before: str | None = None,
    ) -> dict[str, Any]:
        proposal = self._ensure_proposal(workbook_id)
        item = ProposalItem(kind=kind, cell=cell, before=before, after=after, rationale=rationale)
        self.store.append_proposal_item(proposal.id, item)
        self.store.append_audit(
            AuditEvent(
                workbook_id=workbook_id,
                actor="llm",
                action="proposal.item.added",
                detail=f"Staged {kind} on {cell} for review",
            )
        )
        return {"proposal_id": proposal.id, "item_id": item.id, "status": "pending"}

    def _add_comment(self, workbook_id: str, cell: str, body: str) -> dict[str, Any]:
        return self._propose_diff(
            workbook_id=workbook_id, cell=cell, kind="comment", after=body, rationale="Reviewer commentary"
        )
