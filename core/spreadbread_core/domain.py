from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
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


class WorkbookSheet(BaseModel):
    name: str
    rows: int
    columns: int
    formula_cells: int = 0
    populated_cells: int = 0
    sample_rows: list[list[str]] = Field(default_factory=list)


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


class ProposalItem(BaseModel):
    id: str = Field(default_factory=lambda: _id("diff"))
    kind: DiffKind
    cell: str
    before: Optional[str] = None
    after: Optional[str] = None
    rationale: str
    status: ProposalItemStatus = "pending"
    reviewer: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_comment: Optional[str] = None


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
