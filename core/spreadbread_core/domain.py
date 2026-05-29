from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


ProposalStatus = Literal["draft", "pending_approval", "approved", "rejected", "applied"]
ProposalItemStatus = Literal["pending", "approved", "rejected"]
DiffKind = Literal["add", "remove", "update", "comment"]
RiskSeverity = Literal["low", "medium", "high"]
WorkbookAccessRole = Literal["owner", "approver", "reviewer", "editor"]
TrustMode = Literal["direct", "review", "locked"]
CellValueType = Literal["string", "number", "boolean", "blank", "formula"]
ResourceKind = Literal["spreadsheet", "text_document"]
OperationKind = Literal[
    "set_cell_value",
    "set_cell_formula",
    "add_cell_comment",
    "clear_cell",
    "replace_range_values",
    "create_sheet",
    "rename_sheet",
    "add_document_comment",
    "replace_document_text",
    "insert_document_section",
]
OperationRisk = Literal["low", "medium", "high", "critical"]
OperationStatus = Literal["draft", "valid", "invalid", "pending", "approved", "rejected", "applied", "failed"]
OperationValidationStatus = Literal["not_validated", "valid", "invalid"]
AgentRunStatus = Literal["running", "completed", "failed"]


class OperationTarget(BaseModel):
    sheet: Optional[str] = None
    cell: Optional[str] = None
    range: Optional[str] = None
    path: Optional[str] = None

    @classmethod
    def from_cell(cls, cell: str) -> "OperationTarget":
        if "!" not in cell:
            return cls(cell=cell)
        sheet, address = cell.rsplit("!", 1)
        return cls(sheet=sheet.strip("'"), cell=address)


class OperationValidation(BaseModel):
    status: OperationValidationStatus = "not_validated"
    messages: list[str] = Field(default_factory=list)


class Operation(BaseModel):
    id: str = Field(default_factory=lambda: _id("op"))
    resource_id: Optional[str] = None
    provider_id: str = "local_xlsx"
    resource_kind: ResourceKind = "spreadsheet"
    kind: OperationKind
    target: OperationTarget
    before: dict[str, Any] = Field(default_factory=dict)
    after: dict[str, Any] = Field(default_factory=dict)
    rationale: str
    risk: OperationRisk
    required_capability: str
    validation: OperationValidation = Field(default_factory=OperationValidation)
    source_run_id: Optional[str] = None
    status: OperationStatus = "pending"
    approval_status: ProposalItemStatus = "pending"


class Resource(BaseModel):
    """A generic resource (spreadsheet or document) tracked by the system.

    Bridges the gap between the legacy ``Workbook``-centric identity and
    multi-provider resources.  A ``Resource`` with ``provider_id="local_xlsx"``
    maps 1:1 to a ``Workbook`` whose ``id`` equals ``resource.id``.
    """
    id: str = Field(default_factory=lambda: _id("res"))
    provider_id: str = "local_xlsx"
    resource_kind: ResourceKind = "spreadsheet"
    external_id: Optional[str] = None
    name: str = ""
    created_at: str = Field(default_factory=_now)


def new_resource(
    provider_id: str = "local_xlsx",
    resource_kind: ResourceKind = "spreadsheet",
    name: str = "",
    external_id: Optional[str] = None,
) -> Resource:
    return Resource(
        provider_id=provider_id,
        resource_kind=resource_kind,
        name=name,
        external_id=external_id,
    )


class WorkbookNamedRange(BaseModel):
    name: str
    sheet_name: Optional[str] = None
    reference: str


class WorkbookSheet(BaseModel):
    name: str
    rows: int
    columns: int
    formula_cells: int = 0
    populated_cells: int = 0
    sample_rows: list[list[str]] = Field(default_factory=list)
    external_references: list[str] = Field(default_factory=list)
    broken_references: list[str] = Field(default_factory=list)
    stale_markers: list[str] = Field(default_factory=list)


class WorkbookRisk(BaseModel):
    id: str = Field(default_factory=lambda: _id("risk"))
    label: str
    severity: RiskSeverity
    location: str
    summary: str


class WorkbookVersion(BaseModel):
    id: str
    created_at: str
    created_by: str
    note: str


class Workbook(BaseModel):
    id: str
    name: str
    owner: str
    created_at: str
    latest_version_id: str
    sheets: list[WorkbookSheet] = Field(default_factory=list)
    risks: list[WorkbookRisk] = Field(default_factory=list)
    versions: list[WorkbookVersion] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    status: Literal["healthy", "needs_review"] = "needs_review"
    trust_mode: TrustMode = "review"
    named_ranges: list[WorkbookNamedRange] = Field(default_factory=list)
    dependencies: dict[str, list[str]] = Field(default_factory=dict)


class ProposalItem(BaseModel):
    id: str = Field(default_factory=lambda: _id("diff"))
    kind: DiffKind
    cell: str
    before: Optional[str] = None
    after: Optional[str] = None
    after_type: Optional[CellValueType] = None
    rationale: str
    status: ProposalItemStatus = "pending"
    reviewer: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_comment: Optional[str] = None
    operation: Optional[Operation] = None

    def to_operation(
        self,
        resource_id: Optional[str] = None,
        provider_id: str = "local_xlsx",
        validation_status: OperationValidationStatus = "not_validated",
        validation_messages: Optional[list[str]] = None,
        source_run_id: Optional[str] = None,
    ) -> Operation:
        operation_kind = _operation_kind_for_item(self)
        return Operation(
            id=_operation_id_for_item(self.id),
            resource_id=resource_id,
            provider_id=provider_id,
            resource_kind="spreadsheet",
            kind=operation_kind,
            target=OperationTarget.from_cell(self.cell),
            before=_operation_payload(self.before, self.after_type, operation_kind, is_before=True),
            after=_operation_payload(self.after, self.after_type, operation_kind, is_before=False),
            rationale=self.rationale,
            risk=_operation_risk_for_item(self),
            required_capability=_required_capability_for_operation(operation_kind),
            validation=OperationValidation(
                status=validation_status,
                messages=validation_messages or [],
            ),
            source_run_id=source_run_id,
            status=self.status,
            approval_status=self.status,
        )

    def ensure_operation(
        self,
        resource_id: Optional[str] = None,
        provider_id: str = "local_xlsx",
        validation_status: OperationValidationStatus = "not_validated",
        validation_messages: Optional[list[str]] = None,
        source_run_id: Optional[str] = None,
    ) -> Operation:
        if self.operation is None:
            self.operation = self.to_operation(
                resource_id=resource_id,
                provider_id=provider_id,
                validation_status=validation_status,
                validation_messages=validation_messages,
                source_run_id=source_run_id,
            )
        return self.operation


class Proposal(BaseModel):
    id: str
    workbook_id: str
    title: str
    summary: str
    status: ProposalStatus = "pending_approval"
    requested_by: str
    created_at: str
    approval_required: bool = True
    items: list[ProposalItem] = Field(default_factory=list)
    applied_version_id: Optional[str] = None
    applied_at: Optional[str] = None
    applied_by: Optional[str] = None
    source_version_id: Optional[str] = None
    source_version_sha256: Optional[str] = None


class AuditEvent(BaseModel):
    id: str = Field(default_factory=lambda: _id("audit"))
    workbook_id: str
    actor: str
    action: str
    detail: str
    created_at: str = Field(default_factory=_now)


class ReviewSnapshot(BaseModel):
    workbook: Workbook
    proposal: Optional[Proposal] = None
    audit_events: list[AuditEvent] = Field(default_factory=list)


class RunEvent(BaseModel):
    id: str = Field(default_factory=lambda: _id("evt"))
    run_id: str
    kind: str  # tool_call, proposal_created, item_decided, proposal_applied, agent_reply
    detail: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=_now)


class AgentRun(BaseModel):
    id: str = Field(default_factory=lambda: _id("run"))
    workbook_id: str
    mode: str
    prompt: str
    model: str
    status: AgentRunStatus = "running"
    started_at: str = Field(default_factory=_now)
    completed_at: Optional[str] = None
    summary: Optional[str] = None
    error: Optional[str] = None
    tool_calls: int = 0
    proposals_created: int = 0
    items_decided: int = 0
    events: list[RunEvent] = Field(default_factory=list)

    def mark_completed(self, summary: str) -> None:
        self.status = "completed"
        self.completed_at = _now()
        self.summary = summary
        self.error = None

    def mark_failed(self, error: str) -> None:
        self.status = "failed"
        self.completed_at = _now()
        self.error = error


def sync_item_operation_status(item: ProposalItem) -> None:
    if item.operation is None:
        return
    if item.status in ("pending", "approved", "rejected"):
        item.operation.status = item.status
        item.operation.approval_status = item.status


def mark_item_operation_applied(item: ProposalItem) -> None:
    if item.operation is not None:
        item.operation.status = "applied"


def _operation_id_for_item(item_id: str) -> str:
    suffix = item_id.split("_", 1)[-1]
    return f"op_{suffix}"


def _operation_kind_for_item(item: ProposalItem) -> OperationKind:
    if item.kind == "comment":
        return "add_cell_comment"
    if item.kind == "remove":
        return "clear_cell"
    if item.after_type == "formula" or (item.after_type is None and item.after and item.after.startswith("=")):
        return "set_cell_formula"
    return "set_cell_value"


def _operation_payload(
    value: Optional[str],
    value_type: Optional[CellValueType],
    operation_kind: OperationKind,
    *,
    is_before: bool,
) -> dict[str, Any]:
    if operation_kind == "add_cell_comment":
        return {} if is_before else {"comment": value}
    if operation_kind == "clear_cell":
        return {"value": value} if is_before else {"value": None, "value_type": "blank"}
    if operation_kind == "set_cell_formula":
        return {"formula": value}
    return {"value": value, "value_type": value_type}


def _operation_risk_for_item(item: ProposalItem) -> OperationRisk:
    if item.kind == "comment":
        return "low"
    if item.after_type == "formula" or (item.after_type is None and item.after and item.after.startswith("=")):
        return "medium"
    if item.kind == "remove":
        return "medium"
    return "medium"


def _required_capability_for_operation(operation_kind: OperationKind) -> str:
    if operation_kind == "add_cell_comment":
        return "spreadsheet.comment"
    if operation_kind == "set_cell_formula":
        return "spreadsheet.write_formula"
    if operation_kind in ("set_cell_value", "clear_cell"):
        return "spreadsheet.write_cell"
    if operation_kind in ("replace_range_values",):
        return "spreadsheet.batch_update"
    if operation_kind in ("create_sheet", "rename_sheet"):
        return "spreadsheet.structure"
    if operation_kind == "add_document_comment":
        return "document.comment"
    if operation_kind == "replace_document_text":
        return "document.replace_text"
    if operation_kind == "insert_document_section":
        return "document.insert_section"
    return "provider.write"


# ---------------------------------------------------------------------------
# Artifact models
# ---------------------------------------------------------------------------


class ArtifactFinding(BaseModel):
    id: str
    severity: RiskSeverity
    location: str
    summary: str
    detail: str


class ArtifactOperation(BaseModel):
    id: str
    kind: OperationKind
    target: str
    before: Optional[str] = None
    after: Optional[str] = None
    rationale: str
    risk: OperationRisk
    status: OperationStatus
    validation: str  # "valid", "invalid", "not_validated"


class ArtifactTimelineEntry(BaseModel):
    id: str
    kind: str
    detail: str
    created_at: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ArtifactImpact(BaseModel):
    cell: str
    dependents: list[str] = Field(default_factory=list)
    sheets_affected: list[str] = Field(default_factory=list)


class RunArtifacts(BaseModel):
    run_id: str
    workbook_id: str
    workbook_name: str = ""
    latest_proposal_id: Optional[str] = None
    prompt: str
    mode: str
    model: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    summary: Optional[str] = None
    findings: list[ArtifactFinding] = Field(default_factory=list)
    operations: list[ArtifactOperation] = Field(default_factory=list)
    timeline: list[ArtifactTimelineEntry] = Field(default_factory=list)
    dependency_impact: list[ArtifactImpact] = Field(default_factory=list)
    tool_calls: int = 0
    proposals_created: int = 0
    items_decided: int = 0


def new_workbook(name: str, owner: str = "user") -> Workbook:
    wb_id = _id("wb")
    version_id = f"{wb_id}_v001"
    now = _now()
    return Workbook(
        id=wb_id,
        name=name,
        owner=owner,
        created_at=now,
        latest_version_id=version_id,
        versions=[WorkbookVersion(id=version_id, created_at=now, created_by=owner, note="Initial upload")],
    )


def new_proposal(
    workbook_id: str,
    title: str,
    summary: str,
    requested_by: str,
    source_version_id: Optional[str] = None,
    source_version_sha256: Optional[str] = None,
) -> Proposal:
    return Proposal(
        id=_id("prop"),
        workbook_id=workbook_id,
        title=title,
        summary=summary,
        requested_by=requested_by,
        created_at=_now(),
        source_version_id=source_version_id,
        source_version_sha256=source_version_sha256,
    )
