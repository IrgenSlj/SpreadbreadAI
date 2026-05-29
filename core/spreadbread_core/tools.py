"""Tool registry exposed to the LLM.

Every callable here is a tool the model can invoke through Ollama's
tool-calling protocol. Write tools enqueue proposal items for human
approval — they never mutate workbooks directly.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

from .cell_ref import parse_cell
from .domain import (
    AuditEvent,
    CellValueType,
    DiffKind,
    OperationRisk,
    OperationValidation,
    Proposal,
    ProposalItem,
    ResourceKind,
    new_proposal,
)
from .policy import AgentMode, PermissionDecision, evaluate_tool_metadata
from .store import Store
from .validators import validate_operation

ToolSideEffect = Literal["read", "stage", "apply_request", "provider_write"]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]
    write: bool = False
    resource_kind: ResourceKind | None = None
    required_capability: str | None = None
    side_effect: ToolSideEffect = "read"
    allowed_modes: tuple[AgentMode, ...] = ("inspect", "plan", "propose", "apply", "direct", "locked")
    risk: OperationRisk = "low"
    mcp_exposed: bool = True
    skill_exposed: bool = True

    def metadata(self) -> dict[str, Any]:
        return {
            "resource_kind": self.resource_kind,
            "required_capability": self.required_capability,
            "side_effect": self.side_effect,
            "allowed_modes": list(self.allowed_modes),
            "risk": self.risk,
            "mcp_exposed": self.mcp_exposed,
            "skill_exposed": self.skill_exposed,
        }


class ToolRegistry:
    def __init__(self, store: Store):
        self.store = store
        self._tools: dict[str, Tool] = {}
        self._register_builtins()

    # --- public API ----------------------------------------------------
    def list_tools(self, mode: AgentMode | None = None) -> list[Tool]:
        tools = list(self._tools.values())
        if mode is None:
            return tools
        return [tool for tool in tools if self.policy_decision(tool.name, mode).action != "deny"]

    def to_ollama_schema(self, mode: AgentMode | None = None) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in self.list_tools(mode)
        ]

    def policy_decision(self, name: str, mode: AgentMode) -> PermissionDecision:
        if name not in self._tools:
            raise KeyError(f"unknown tool: {name}")
        return evaluate_tool_metadata(self._tools[name].metadata(), mode)

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
                side_effect="read",
            )
        )
        self._add(
            Tool(
                name="get_review_snapshot",
                description="Get the full review snapshot for a workbook: sheets, risks, latest proposal, audit trail.",
                parameters={
                    "type": "object",
                    "properties": {"workbook_id": {"type": "string"}, "resource_id": {"type": "string"}},
                    "required": ["workbook_id"],
                },
                handler=self._get_review_snapshot,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.read",
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
                        "resource_id": {"type": "string"},
                        "sheet_name": {"type": "string"},
                    },
                    "required": ["workbook_id", "sheet_name"],
                },
                handler=self._inspect_sheet,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.read",
            )
        )
        self._add(
            Tool(
                name="list_risks",
                description="List risks detected on a workbook (formula chains, stale inputs, reference drift).",
                parameters={
                    "type": "object",
                    "properties": {"workbook_id": {"type": "string"}, "resource_id": {"type": "string"}},
                    "required": ["workbook_id"],
                },
                handler=self._list_risks,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.read",
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
                        "resource_id": {"type": "string"},
                        "cell": {"type": "string", "description": "e.g. Forecast!G18"},
                        "kind": {"type": "string", "enum": ["add", "remove", "update", "comment"]},
                        "after": {"type": "string"},
                        "after_type": {
                            "type": "string",
                            "enum": ["string", "number", "boolean", "blank", "formula"],
                            "description": (
                                "Type of the proposed after value. Use string for IDs, codes, "
                                "and leading-zero values; number only for real numeric cells."
                            ),
                        },
                        "before": {"type": "string"},
                        "rationale": {"type": "string"},
                    },
                    "required": ["workbook_id", "cell", "kind", "rationale"],
                },
                handler=self._propose_diff,
                write=True,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.write_cell",
                side_effect="stage",
                allowed_modes=("propose", "direct"),
                risk="medium",
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
                        "resource_id": {"type": "string"},
                        "cell": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["workbook_id", "cell", "body"],
                },
                handler=self._add_comment,
                write=True,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.comment",
                side_effect="stage",
                allowed_modes=("propose", "direct"),
                risk="low",
            )
        )
        self._add(
            Tool(
                name="get_dependencies",
                description="Return the cells that the formula at a given cell address depends on.",
                parameters={
                    "type": "object",
                    "properties": {
                        "workbook_id": {"type": "string"},
                        "resource_id": {"type": "string"},
                        "cell": {"type": "string", "description": "Fully-qualified address, e.g. Forecast!C7"},
                    },
                    "required": ["workbook_id", "cell"],
                },
                handler=self._get_dependencies,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.read",
            )
        )
        self._add(
            Tool(
                name="find_external_references",
                description="List every cell that references an external workbook file.",
                parameters={
                    "type": "object",
                    "properties": {"workbook_id": {"type": "string"}, "resource_id": {"type": "string"}},
                    "required": ["workbook_id"],
                },
                handler=self._find_external_references,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.read",
            )
        )
        self._add(
            Tool(
                name="get_named_ranges",
                description="Return all defined named ranges in the workbook.",
                parameters={
                    "type": "object",
                    "properties": {"workbook_id": {"type": "string"}, "resource_id": {"type": "string"}},
                    "required": ["workbook_id"],
                },
                handler=self._get_named_ranges,
                resource_kind="spreadsheet",
                required_capability="spreadsheet.read",
            )
        )

    # --- helpers -------------------------------------------------------
    @staticmethod
    def _resolve_id(workbook_id: str | None = None, resource_id: str | None = None) -> str:
        """Resolve the effective resource ID, preferring workbook_id for backward compat."""
        resolved = workbook_id or resource_id
        if resolved is None:
            raise KeyError("either workbook_id or resource_id is required")
        return resolved

    # --- handlers ------------------------------------------------------
    def _list_workbooks(self) -> list[dict[str, Any]]:
        return [
            {"id": wb.id, "name": wb.name, "owner": wb.owner, "status": wb.status, "sheets": len(wb.sheets)}
            for wb in self.store.list_workbooks()
        ]

    def _get_review_snapshot(
        self, workbook_id: str | None = None, resource_id: str | None = None
    ) -> dict[str, Any]:
        rid = self._resolve_id(workbook_id, resource_id)
        snap = self.store.review_snapshot(rid)
        if not snap:
            raise KeyError(f"workbook {rid} not found")
        return snap.model_dump()

    def _inspect_sheet(
        self, workbook_id: str | None = None, sheet_name: str | None = None, resource_id: str | None = None
    ) -> dict[str, Any]:
        rid = self._resolve_id(workbook_id, resource_id)
        wb = self.store.get_workbook(rid)
        if not wb:
            raise KeyError(f"workbook {rid} not found")
        for sheet in wb.sheets:
            if sheet.name == sheet_name:
                return sheet.model_dump()
        raise KeyError(f"sheet {sheet_name} not found in {rid}")

    def _list_risks(self, workbook_id: str | None = None, resource_id: str | None = None) -> list[dict[str, Any]]:
        rid = self._resolve_id(workbook_id, resource_id)
        wb = self.store.get_workbook(rid)
        if not wb:
            raise KeyError(f"workbook {rid} not found")
        return [r.model_dump() for r in wb.risks]

    def _validate_target_cell(self, workbook_id: str | None = None, cell: str | None = None, resource_id: str | None = None) -> None:
        rid = self._resolve_id(workbook_id, resource_id)
        wb = self.store.get_workbook(rid)
        if not wb:
            raise KeyError(f"workbook {rid} not found")
        ref = parse_cell(cell)
        if ref.sheet and ref.sheet not in {sheet.name for sheet in wb.sheets}:
            raise ValueError(f"sheet {ref.sheet!r} not found in workbook {rid}")

    def _ensure_proposal(self, workbook_id: str | None = None, resource_id: str | None = None) -> Proposal:
        rid = self._resolve_id(workbook_id, resource_id)
        proposal = self.store.latest_proposal_for(rid)
        if proposal and proposal.status in ("draft", "pending_approval"):
            return proposal
        wb = self.store.get_workbook(rid)
        sha = self.store.version_sha256(rid, wb.latest_version_id) if wb else None
        proposal = new_proposal(
            workbook_id=rid,
            title="AI review draft",
            summary="Automated review proposal pending human approval.",
            requested_by="llm",
            source_version_id=wb.latest_version_id if wb else None,
            source_version_sha256=sha,
        )
        self.store.save_proposal(proposal)
        self.store.append_audit(
            AuditEvent(
                workbook_id=rid,
                actor="llm",
                action="proposal.created",
                detail=f"Created proposal {proposal.id}",
            )
        )
        return proposal

    def _propose_diff(
        self,
        workbook_id: str | None = None,
        cell: str | None = None,
        kind: DiffKind | None = None,
        rationale: str | None = None,
        after: str | None = None,
        after_type: CellValueType | None = None,
        before: str | None = None,
        resource_id: str | None = None,
    ) -> dict[str, Any]:
        rid = self._resolve_id(workbook_id, resource_id)
        self._validate_target_cell(rid, cell)
        proposal = self._ensure_proposal(rid)
        item = ProposalItem(
            kind=kind,
            cell=cell,
            before=before,
            after=after,
            after_type=after_type,
            rationale=rationale,
        )
        op = item.ensure_operation(resource_id=rid, validation_status="not_validated")
        wb = self.store.get_workbook(rid)
        if wb is not None and op.kind == "set_cell_formula":
            op.validation = validate_operation(
                op,
                wb.dependencies,
                [s.name for s in wb.sheets],
            )
        else:
            op.validation = OperationValidation(status="valid")
        self.store.append_proposal_item(proposal.id, item)
        self.store.append_audit(
            AuditEvent(
                workbook_id=rid,
                actor="llm",
                action="proposal.item.added",
                detail=f"Staged {kind} on {cell} for review",
            )
        )
        return {"proposal_id": proposal.id, "item_id": item.id, "status": "pending"}

    def _add_comment(
        self,
        workbook_id: str | None = None,
        cell: str | None = None,
        body: str | None = None,
        resource_id: str | None = None,
    ) -> dict[str, Any]:
        rid = self._resolve_id(workbook_id, resource_id)
        return self._propose_diff(
            workbook_id=rid, cell=cell, kind="comment", after=body, rationale="Reviewer commentary"
        )

    def _get_dependencies(
        self, workbook_id: str | None = None, cell: str | None = None, resource_id: str | None = None
    ) -> dict[str, Any]:
        rid = self._resolve_id(workbook_id, resource_id)
        wb = self.store.get_workbook(rid)
        if not wb:
            raise KeyError(f"workbook {rid} not found")
        return {"cell": cell, "depends_on": wb.dependencies.get(cell, [])}

    def _find_external_references(
        self, workbook_id: str | None = None, resource_id: str | None = None
    ) -> list[dict[str, Any]]:
        rid = self._resolve_id(workbook_id, resource_id)
        wb = self.store.get_workbook(rid)
        if not wb:
            raise KeyError(f"workbook {rid} not found")
        result: list[dict[str, Any]] = []
        for sheet in wb.sheets:
            for cell_addr in sheet.external_references:
                result.append({"sheet": sheet.name, "cell": cell_addr})
        return result

    def _get_named_ranges(
        self, workbook_id: str | None = None, resource_id: str | None = None
    ) -> list[dict[str, Any]]:
        rid = self._resolve_id(workbook_id, resource_id)
        wb = self.store.get_workbook(rid)
        if not wb:
            raise KeyError(f"workbook {rid} not found")
        return [nr.model_dump() for nr in wb.named_ranges]
