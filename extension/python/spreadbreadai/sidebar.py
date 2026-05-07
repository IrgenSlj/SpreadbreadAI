"""Sidebar rendering and protocol-handler dispatch.

The sidebar UI for LibreOffice can be rendered either through the
Sidebar XCU (declarative) or by opening a UNO dialog from Python. The
v0.1 implementation uses simple message boxes and a quick text dialog
so we can get an end-to-end loop working before investing in custom
panels. Phase 2.5 will replace this with a real .ui-defined panel.
"""
from __future__ import annotations

from typing import Any

from .calc_bridge import ActiveCalc
from .client import DaemonClient, DaemonError


def _show_message(ctx: Any, title: str, body: str) -> None:  # pragma: no cover - requires UNO
    smgr = ctx.ServiceManager
    toolkit = smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", ctx)
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    parent = desktop.getCurrentFrame().getContainerWindow() if desktop.getCurrentFrame() else None
    box = toolkit.createMessageBox(parent, 1, 1, title, body)  # INFOBOX, OK
    box.execute()


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
    file_path = file_url.replace("file://", "")

    try:
        workbook = client.upload_workbook(file_path)
        wb_id = workbook["id"]
        client.chat(wb_id, "Inspect the workbook and stage any proposals you'd recommend.")
        snapshot = client.review_snapshot(wb_id)
    except DaemonError as exc:
        _show_message(ctx, "SpreadbreadAI", f"Review failed.\n\n{exc}")
        return

    _show_message(ctx, "SpreadbreadAI Review", _format_snapshot(snapshot))


def handle_apply(ctx: Any, client: DaemonClient) -> None:  # pragma: no cover - requires UNO
    _show_message(ctx, "SpreadbreadAI", "Apply pipeline lands in Phase 3.")
