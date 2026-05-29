"""Apply pipeline.

Takes a proposal whose items have been reviewed and produces a new
workbook version by dispatching approved operations through the
appropriate provider adapter. Idempotent per proposal.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from openpyxl import load_workbook as _load
from openpyxl.comments import Comment

from .cell_ref import parse_cell
from .domain import AuditEvent, Operation, Proposal, ProposalItem, WorkbookVersion, _now, _id, mark_item_operation_applied
from .providers.local_xlsx import LocalXlsxAdapter
from .store import Store
from .validators import validate_operation


class ApplyError(Exception):
    """Raised when a proposal cannot be applied for a domain reason."""


@dataclass
class ApplyResult:
    proposal: Proposal
    version: WorkbookVersion
    applied_item_ids: list[str]


# -- provider adapter registry ------------------------------------------------
_ADAPTERS: dict[str, Any] = {}


def _get_adapter(provider_id: str):
    if not _ADAPTERS:
        _ADAPTERS["local_xlsx"] = LocalXlsxAdapter()
    adapter = _ADAPTERS.get(provider_id)
    if adapter is None:
        raise ApplyError(f"unsupported provider {provider_id!r}")
    return adapter


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


def _operation_for_item(item: ProposalItem, workbook_id: str, store: Store) -> Operation:
    operation = item.ensure_operation(resource_id=workbook_id, validation_status="not_validated")
    if operation.resource_id and operation.resource_id != workbook_id:
        raise ApplyError(f"operation {operation.id} targets a different resource")
    if operation.resource_kind != "spreadsheet":
        raise ApplyError(f"operation {operation.id} is not a spreadsheet operation")

    # Safety-net re-validation before apply.
    if operation.validation.status != "invalid" and operation.kind == "set_cell_formula":
        wb = store.get_workbook(workbook_id)
        if wb is not None:
            operation.validation = validate_operation(
                operation,
                wb.dependencies,
                [s.name for s in wb.sheets],
            )

    if operation.validation.status == "invalid":
        detail = "; ".join(operation.validation.messages) or "operation validation failed"
        raise ApplyError(f"operation {operation.id} is invalid: {detail}")
    return operation


def _select_operation_cell(book, operation: Operation):
    if not operation.target.cell:
        raise ApplyError(f"operation {operation.id} has no target cell")
    sheet = _select_sheet(book, operation.target.sheet)
    return sheet[operation.target.cell]


def _typed_operation_value(operation: Operation, item: ProposalItem) -> Any:
    if operation.kind == "set_cell_formula":
        return operation.after.get("formula")
    if operation.kind == "set_cell_value":
        value = operation.after.get("value")
        if "value_type" not in operation.after:
            return _typed_value(item)
        value_type = operation.after.get("value_type")
        proxy = item.model_copy(update={"after": value, "after_type": value_type})
        return _typed_value(proxy)
    raise ApplyError(f"operation {operation.id} cannot be converted to a cell value")


def _write_operation(book, item: ProposalItem, workbook_id: str, store: Store) -> None:
    operation = _operation_for_item(item, workbook_id, store)
    if operation.kind == "add_cell_comment":
        cell = _select_operation_cell(book, operation)
        cell.comment = Comment(operation.after.get("comment") or item.after or item.rationale, "spreadbreadai")
        return
    if operation.kind == "clear_cell":
        cell = _select_operation_cell(book, operation)
        cell.value = None
        return
    if operation.kind in ("set_cell_value", "set_cell_formula"):
        cell = _select_operation_cell(book, operation)
        cell.value = _typed_operation_value(operation, item)
        return
    raise ApplyError(f"operation {operation.id} has unsupported kind {operation.kind!r}")


def _write_item(book, item: ProposalItem, workbook_id: str, store: Store) -> None:
    if item.operation is not None:
        _write_operation(book, item, workbook_id, store)
        return
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

    # Conflict detection
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

    # Determine which provider to use for this proposal's items.
    # All items in a proposal must share the same provider for now.
    provider_id = "local_xlsx"
    for item in approved:
        if item.operation is not None and item.operation.provider_id != provider_id:
            provider_id = item.operation.provider_id
            break

    base_bytes = store.load_version_bytes(workbook.id, base_version_id)

    if provider_id == "local_xlsx":
        # Legacy apply path for local_xlsx (preserves exact existing behaviour)
        book = _load(io.BytesIO(base_bytes), data_only=False, read_only=False)
        for item in approved:
            _write_item(book, item, proposal.workbook_id, store)
        out = io.BytesIO()
        book.save(out)
        new_bytes = out.getvalue()
    else:
        # Adapter-based apply for other providers
        adapter = _get_adapter(provider_id)
        operations = []
        for item in approved:
            op = _operation_for_item(item, proposal.workbook_id, store)
            operations.append(op)
        new_bytes = adapter.apply_operations(operations, base_bytes)

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
    for item in approved:
        mark_item_operation_applied(item)
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
