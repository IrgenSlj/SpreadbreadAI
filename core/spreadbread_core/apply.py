"""Apply pipeline.

Takes a proposal whose items have been reviewed and produces a new
workbook version by writing approved diffs into a copy of the base
xlsx. Idempotent per proposal: a proposal in `applied` status returns
its existing version without rewriting.

Rules:
- Every item in the proposal must have a non-pending status. If any
  item is still pending, apply is rejected (409).
- At least one item must be approved. A proposal with all items
  rejected has nothing to apply (409).
- The base version is the workbook's `latest_version_id` at the time
  of apply. The new version is appended to the workbook.
- Comment items are written as openpyxl Comment objects on their cell.
- Add / update items write a value or a formula (formula if the value
  starts with `=`).
- Remove items clear the cell.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from openpyxl import load_workbook as _load
from openpyxl.comments import Comment

from .cell_ref import parse_cell
from .domain import AuditEvent, Proposal, ProposalItem, WorkbookVersion, _now, _id
from .store import Store


class ApplyError(Exception):
    """Raised when a proposal cannot be applied for a domain reason."""


@dataclass
class ApplyResult:
    proposal: Proposal
    version: WorkbookVersion
    applied_item_ids: list[str]


def _select_sheet(book, sheet_name: str | None):
    if sheet_name is None:
        return book.active
    if sheet_name not in book.sheetnames:
        raise ApplyError(f"sheet {sheet_name!r} not found")
    return book[sheet_name]


def _typed_value(item: ProposalItem) -> Any:
    value = item.after
    value_type = item.after_type
    if value_type == "blank":
        return None
    if value is None:
        return None
    if value_type == "formula" or (value_type is None and value.startswith("=")):
        return value
    if value_type == "number":
        try:
            number = Decimal(value)
        except InvalidOperation as exc:
            raise ApplyError(f"invalid number for {item.cell}: {value!r}") from exc
        if number == number.to_integral_value():
            return int(number)
        return float(number)
    if value_type == "boolean":
        normalized = value.strip().lower()
        if normalized in ("true", "1", "yes"):
            return True
        if normalized in ("false", "0", "no"):
            return False
        raise ApplyError(f"invalid boolean for {item.cell}: {value!r}")
    return value


def _write_item(book, item: ProposalItem) -> None:
    try:
        ref = parse_cell(item.cell)
    except ValueError as exc:
        raise ApplyError(str(exc)) from exc
    sheet = _select_sheet(book, ref.sheet)
    cell = sheet[ref.address]
    if item.kind == "comment":
        cell.comment = Comment(item.after or item.rationale, "spreadbreadai")
        return
    if item.kind == "remove":
        cell.value = None
        return
    cell.value = _typed_value(item)


def apply_proposal(store: Store, proposal_id: str, reviewer: str = "system") -> ApplyResult:
    proposal = store.get_proposal(proposal_id)
    if not proposal:
        raise ApplyError(f"proposal {proposal_id} not found")
    workbook = store.get_workbook(proposal.workbook_id)
    if not workbook:
        raise ApplyError(f"workbook {proposal.workbook_id} not found")

    # idempotent short-circuit
    if proposal.status == "applied" and proposal.applied_version_id:
        existing_version = next(
            (v for v in workbook.versions if v.id == proposal.applied_version_id), None
        )
        if existing_version:
            return ApplyResult(proposal, existing_version, [i.id for i in proposal.items if i.status == "approved"])

    pending = [i for i in proposal.items if i.status == "pending"]
    if pending:
        raise ApplyError(f"{len(pending)} item(s) still pending review")
    approved = [i for i in proposal.items if i.status == "approved"]
    if not approved:
        raise ApplyError("no approved items to apply")

    # Conflict detection: refuse if the workbook has moved since the
    # proposal was generated. source_version_id is set by _ensure_proposal
    # at proposal-creation time. If unset (legacy proposals), fall back
    # to the current latest version, but log it so the audit trail shows
    # we trusted the workbook implicitly.
    base_version_id = proposal.source_version_id or workbook.latest_version_id
    if proposal.source_version_id and proposal.source_version_id != workbook.latest_version_id:
        raise ApplyError(
            f"workbook has moved since proposal was created "
            f"(proposal source: {proposal.source_version_id}, workbook latest: {workbook.latest_version_id}) "
            f"— regenerate the proposal against the current version"
        )
    if not store.has_version_bytes(workbook.id, base_version_id):
        raise ApplyError("base workbook bytes missing — workbook was not uploaded")
    if proposal.source_version_sha256:
        actual_sha = store.version_sha256(workbook.id, base_version_id)
        if actual_sha != proposal.source_version_sha256:
            raise ApplyError(
                "base workbook bytes have been modified since the proposal "
                "was created (sha256 mismatch)"
            )

    base_bytes = store.load_version_bytes(workbook.id, base_version_id)
    book = _load(io.BytesIO(base_bytes), data_only=False, read_only=False)

    for item in approved:
        _write_item(book, item)

    out = io.BytesIO()
    book.save(out)
    new_bytes = out.getvalue()

    new_version_id = _id("wbv")
    now = _now()
    new_version = WorkbookVersion(
        id=new_version_id,
        created_at=now,
        created_by=reviewer,
        note=f"Applied proposal {proposal.id} ({len(approved)} item{'s' if len(approved) != 1 else ''})",
    )
    workbook.versions.append(new_version)
    workbook.latest_version_id = new_version_id
    workbook.status = "healthy"
    store.save_workbook(workbook)
    store.save_version_bytes(workbook.id, new_version_id, new_bytes)

    proposal.status = "applied"
    proposal.applied_version_id = new_version_id
    proposal.applied_at = now
    proposal.applied_by = reviewer
    store.save_proposal(proposal)

    store.append_audit(
        AuditEvent(
            workbook_id=workbook.id,
            actor=reviewer,
            action="proposal.applied",
            detail=f"Applied {len(approved)} item(s) from {proposal.id}; new version {new_version_id}",
        )
    )
    store.append_audit(
        AuditEvent(
            workbook_id=workbook.id,
            actor="system",
            action="version.created",
            detail=f"Workbook version {new_version_id} created",
        )
    )

    return ApplyResult(proposal, new_version, [i.id for i in approved])
