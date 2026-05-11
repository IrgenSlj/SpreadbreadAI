"""Sidebar rendering and protocol-handler dispatch.

The sidebar UI for LibreOffice can be rendered either through the
Sidebar XCU (declarative) or by opening a UNO dialog from Python. The
v0.1 implementation uses simple message boxes and a quick text dialog
so we can get an end-to-end loop working before investing in custom
panels. Phase 2.5 will replace this with a real .ui-defined panel.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import unquote, urlparse

from .calc_bridge import ActiveCalc
from .client import DaemonClient, DaemonError

_WORKBOOK_IDS_BY_FILE_URL: dict[str, str] = {}


def _file_url_to_path(file_url: str) -> str | None:
    parsed = urlparse(file_url)
    if parsed.scheme != "file":
        return None
    path = unquote(parsed.path)
    if parsed.netloc:
        path = f"//{parsed.netloc}{path}"
    if len(path) >= 3 and path[0] == "/" and path[2] == ":":
        path = path[1:]
    return path


def _remember_workbook(file_url: str, workbook_id: str) -> None:
    _WORKBOOK_IDS_BY_FILE_URL[file_url] = workbook_id


def _remembered_workbook(file_url: str) -> str | None:
    return _WORKBOOK_IDS_BY_FILE_URL.get(file_url)


def _show_message(ctx: Any, title: str, body: str) -> None:  # pragma: no cover - requires UNO
    smgr = ctx.ServiceManager
    toolkit = smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", ctx)
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    parent = desktop.getCurrentFrame().getContainerWindow() if desktop.getCurrentFrame() else None
    box = toolkit.createMessageBox(parent, 1, 1, title, body)  # INFOBOX, OK
    box.execute()


def _confirm(ctx: Any, title: str, body: str) -> bool:  # pragma: no cover - requires UNO
    smgr = ctx.ServiceManager
    toolkit = smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", ctx)
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    parent = desktop.getCurrentFrame().getContainerWindow() if desktop.getCurrentFrame() else None
    # 4 = QUERYBOX, 3 = YES_NO buttons; returns 2 for YES
    box = toolkit.createMessageBox(parent, 4, 3, title, body)
    return box.execute() == 2


def _format_snapshot(snapshot: dict[str, Any]) -> str:
    workbook = snapshot.get("workbook", {})
    proposal = snapshot.get("proposal") or {}
    risks = workbook.get("risks", [])
    items = proposal.get("items", [])

    lines: list[str] = []
    lines.append(f"Workbook: {workbook.get('name')} ({workbook.get('id')})")
    lines.append(f"Sheets: {len(workbook.get('sheets', []))}  Risks: {len(risks)}")
    lines.append("")
    if risks:
        lines.append("Risks")
        lines.append("-----")
        for r in risks:
            lines.append(f"  [{r['severity']}] {r['location']} — {r['summary']}")
        lines.append("")
    if items:
        lines.append(f"Proposal: {proposal.get('title')} ({proposal.get('status')})")
        for item in items:
            arrow = " -> "
            before = item.get("before") or "(empty)"
            after = item.get("after") or "(empty)"
            lines.append(
                f"  [{item['status']}] {item['kind']} {item['cell']}: {before}{arrow}{after}"
            )
            lines.append(f"    rationale: {item.get('rationale', '')}")
    else:
        lines.append("No proposal yet — run Review with SpreadbreadAI.")
    return "\n".join(lines)


def handle_review(ctx: Any, client: DaemonClient) -> None:  # pragma: no cover - requires UNO
    try:
        client.healthz()
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Daemon not reachable.\n\n{exc}")
        return

    calc = ActiveCalc(ctx)
    file_url = calc.file_url()
    if not file_url or not file_url.startswith("file://"):
        _show_message(ctx, "SpreadbreadAI", "Save the workbook to disk before review.")
        return
    file_path = _file_url_to_path(file_url)
    if not file_path:
        _show_message(ctx, "SpreadbreadAI", "Could not resolve the workbook file path.")
        return

    try:
        workbook = client.upload_workbook(file_path)
        wb_id = workbook["id"]
        _remember_workbook(file_url, wb_id)
        client.chat(wb_id, "Inspect the workbook and stage any proposals you'd recommend.")
        snapshot = client.review_snapshot(wb_id)
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Review failed.\n\n{exc}")
        return

    _show_message(ctx, "SpreadbreadAI Review", _format_snapshot(snapshot))


def handle_approve_all(ctx: Any, client: DaemonClient) -> None:  # pragma: no cover - requires UNO
    try:
        client.healthz()
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Daemon not reachable.\n\n{exc}")
        return

    file_url = ActiveCalc(ctx).file_url()
    if not file_url:
        _show_message(ctx, "SpreadbreadAI", "Save and review this workbook before approving.")
        return
    wb_id = _remembered_workbook(file_url)
    if not wb_id:
        _show_message(ctx, "SpreadbreadAI", "Run Review for this workbook before approving.")
        return

    try:
        snapshot = client.review_snapshot(wb_id)
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Could not load review.\n\n{exc}")
        return

    proposal = snapshot.get("proposal") or {}
    if not proposal:
        _show_message(ctx, "SpreadbreadAI", "Nothing to approve: no proposal yet.")
        return
    pending = [i for i in proposal.get("items", []) if i.get("status") == "pending"]
    if not pending:
        _show_message(
            ctx,
            "SpreadbreadAI",
            "No pending items to approve. You may now run Apply.",
        )
        return

    preview = "\n".join(
        f"  • [{item['kind']}] {item['cell']}: {item.get('before') or '(empty)'} -> {item.get('after') or '(empty)'}"
        for item in pending
    )
    if not _confirm(
        ctx,
        "SpreadbreadAI — approve all pending",
        f"Approve {len(pending)} pending item(s)?\n\n{preview}\n\n"
        "Approving lets the next Apply step write these to the workbook.",
    ):
        return

    try:
        result = client.approve_all(proposal["id"])
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Approval failed.\n\n{exc}")
        return
    flipped = result.get("flipped_item_ids", [])
    _show_message(
        ctx,
        "SpreadbreadAI",
        f"Approved {len(flipped)} item(s). Run Apply to write the changes.",
    )


def handle_apply(ctx: Any, client: DaemonClient) -> None:  # pragma: no cover - requires UNO
    try:
        client.healthz()
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Daemon not reachable.\n\n{exc}")
        return

    file_url = ActiveCalc(ctx).file_url()
    if not file_url:
        _show_message(ctx, "SpreadbreadAI", "Save and review this workbook before applying.")
        return
    wb_id = _remembered_workbook(file_url)
    if not wb_id:
        _show_message(ctx, "SpreadbreadAI", "Run Review for this workbook before applying.")
        return

    try:
        snapshot = client.review_snapshot(wb_id)
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Could not load review.\n\n{exc}")
        return

    proposal = snapshot.get("proposal") or {}
    if not proposal:
        _show_message(ctx, "SpreadbreadAI", "Nothing to apply: no proposal yet.")
        return

    approved = [i for i in proposal.get("items", []) if i.get("status") == "approved"]
    if not approved:
        _show_message(
            ctx,
            "SpreadbreadAI",
            "No approved items. Approve at least one diff before applying.",
        )
        return

    # Order matters: the daemon is the source of truth, so we commit the
    # canonical version FIRST. Only on success do we write to the active
    # Calc document as a UX courtesy. If the Calc write fails afterwards,
    # the user can re-open the canonical version from disk; if we wrote
    # to Calc first and the daemon then refused (conflict, sha mismatch),
    # the user would see ghost cells with no audit trail.
    try:
        result = client.apply(proposal["id"])
    except DaemonError as exc:
        _show_message(
            ctx,
            "SpreadbreadAI",
            f"Daemon refused to apply.\n\n{exc}\n\n"
            "Nothing was written to the active sheet.",
        )
        return

    calc = ActiveCalc(ctx)
    written: list[str] = []
    failed: list[tuple[str, str]] = []
    for item in approved:
        if item.get("kind") == "comment":
            continue
        try:
            value = item.get("after")
            if value is None and item.get("kind") != "remove":
                continue
            value_type = "blank" if item.get("kind") == "remove" else item.get("after_type")
            calc.write_cell(
                item["cell"],
                None if item.get("kind") == "remove" else str(value),
                value_type=value_type,
            )
            written.append(item["cell"])
        except Exception as exc:
            failed.append((item["cell"], str(exc)))

    version = result.get("version", {})
    msg = [
        f"Applied {len(approved)} item(s) on the daemon.",
        f"New canonical version: {version.get('id')}",
        f"Note: {version.get('note')}",
        "",
    ]
    if written:
        msg.append(f"Mirrored into the active sheet: {', '.join(written)}")
    if failed:
        msg.append(
            f"Could not mirror {len(failed)} cell(s) into the active sheet "
            "(canonical version is correct on disk):"
        )
        for cell, err in failed:
            msg.append(f"  {cell}: {err}")
        msg.append(
            f"Re-open {version.get('id')}.xlsx from the data directory to see the canonical state."
        )
    _show_message(ctx, "SpreadbreadAI", "\n".join(msg))
