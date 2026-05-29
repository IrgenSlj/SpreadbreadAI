"""Pre-apply validators for operations.

Detects circular references and broken sheet references that would
create #REF! errors — the #1 way AI spreadsheet tools break models.
"""
from __future__ import annotations

from typing import Optional

from .domain import Operation, OperationValidation

# Reuse formula-parsing helpers from the parser module.
from .parser import _extract_range_tokens, _sheet_names_from_tokens


def _operation_cell_address(op: Operation) -> Optional[str]:
    """Return the fully-qualified cell address for an operation,
    e.g. 'Forecast!C3'."""
    target = op.target
    if not target.cell:
        return None
    if target.sheet:
        return f"{target.sheet}!{target.cell}"
    return target.cell


def _referenced_sheets(formula: str) -> list[str]:
    """Extract sheet names referenced in a formula."""
    tokens = _extract_range_tokens(formula)
    return _sheet_names_from_tokens(tokens)


def _referenced_cells(
    formula: str,
    default_sheet: Optional[str],
) -> list[str]:
    """Extract fully-qualified cell addresses referenced in a formula.

    Local refs (e.g. ``A1``) are qualified with *default_sheet*.
    """
    cells: list[str] = []
    for tok in _extract_range_tokens(formula):
        if "!" in tok:
            cells.append(tok)
        elif default_sheet:
            cells.append(f"{default_sheet}!{tok}")
    return cells


def _walk_dependency_chain(
    start: str,
    target: str,
    dependencies: dict[str, list[str]],
    visited: Optional[set[str]] = None,
) -> bool:
    """Return True if walking from *start* reaches *target*."""
    if visited is None:
        visited = set()
    if start in visited:
        return False
    visited.add(start)
    deps = dependencies.get(start, [])
    for dep in deps:
        if dep == target:
            return True
        if _walk_dependency_chain(dep, target, dependencies, visited):
            return True
    return False


def validate_operation(
    operation: Operation,
    existing_dependencies: dict[str, list[str]],
    known_sheets: list[str],
) -> OperationValidation:
    """Run all validators against an operation.

    Args:
        operation: The operation to validate.
        existing_dependencies: The workbook's current dependency graph
            (before this operation is applied).
        known_sheets: List of existing sheet names in the workbook.

    Returns:
        ``OperationValidation`` with ``status="valid"`` or
        ``status="invalid"`` plus human-readable messages.
    """
    if operation.kind != "set_cell_formula":
        return OperationValidation(status="valid")

    formula = operation.after.get("formula", "")
    if not formula:
        return OperationValidation(status="valid")

    msgs: list[str] = []
    cell_address = _operation_cell_address(operation)

    # --- Direct self-reference check -----------------------------------
    # A formula like =A1+1 written at cell A1 is an immediate cycle.
    if cell_address and _formula_contains_cell_ref(formula, cell_address):
        msgs.append(
            f"Formula at {cell_address} directly references itself — "
            f"would create a circular reference"
        )

    # --- Indirect circular reference check -----------------------------
    if cell_address and not msgs:
        new_deps = _referenced_cells(formula, operation.target.sheet)
        for dep in new_deps:
            if dep == cell_address:
                continue  # already caught above
            if _walk_dependency_chain(dep, cell_address, existing_dependencies):
                msgs.append(
                    f"Formula at {cell_address} would create a circular "
                    f"reference through {dep}"
                )
                break

    # --- Broken sheet reference check ----------------------------------
    for ref_sheet in _referenced_sheets(formula):
        if ref_sheet not in known_sheets:
            msgs.append(
                f"Formula references sheet {ref_sheet!r} which does not "
                f"exist in the workbook"
            )

    if msgs:
        return OperationValidation(status="invalid", messages=msgs)
    return OperationValidation(status="valid")


def _formula_contains_cell_ref(formula: str, cell_address: str) -> bool:
    """Check if a formula text directly mentions *cell_address*.

    Works for both qualified (``Sheet1!A1``) and unqualified (``A1``)
    references.  Uses the tokenizer so ``A1`` inside ``=AVERAGE(A1:A10)``
    is correctly detected.
    """
    # Parse the cell-address parts
    if "!" in cell_address:
        _sheet, cell_part = cell_address.split("!", 1)
    else:
        cell_part = cell_address

    for tok in _extract_range_tokens(formula):
        # Strip any sheet prefix for comparison
        tok_cell = tok.split("!")[-1] if "!" in tok else tok
        if tok_cell == cell_part:
            return True
    return False
