from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from .domain import (
    AgentRun,
    AuditEvent,
    Proposal,
    ProposalItem,
    ReviewSnapshot,
    Workbook,
    _now,
    sync_item_operation_status,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS workbooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_workbook ON proposals(workbook_id);
CREATE INDEX IF NOT EXISTS idx_audit_workbook ON audit_events(workbook_id, created_at);
CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workbook ON agent_runs(workbook_id, started_at);
"""


class Store:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.workbooks_dir = db_path.parent / "workbooks"
        self.workbooks_dir.mkdir(parents=True, exist_ok=True)
        with self._conn() as cx:
            cx.executescript(SCHEMA)

    # --- workbook bytes -----------------------------------------------
    def _version_path(self, workbook_id: str, version_id: str) -> Path:
        return self.workbooks_dir / workbook_id / f"{version_id}.xlsx"

    def save_version_bytes(self, workbook_id: str, version_id: str, data: bytes) -> Path:
        path = self._version_path(workbook_id, version_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def load_version_bytes(self, workbook_id: str, version_id: str) -> bytes:
        path = self._version_path(workbook_id, version_id)
        if not path.exists():
            raise FileNotFoundError(f"version bytes missing: {path}")
        return path.read_bytes()

    def has_version_bytes(self, workbook_id: str, version_id: str) -> bool:
        return self._version_path(workbook_id, version_id).exists()

    def version_sha256(self, workbook_id: str, version_id: str) -> Optional[str]:
        if not self.has_version_bytes(workbook_id, version_id):
            return None
        import hashlib
        return hashlib.sha256(self.load_version_bytes(workbook_id, version_id)).hexdigest()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        cx = sqlite3.connect(self.db_path)
        cx.execute("PRAGMA foreign_keys = ON")
        cx.row_factory = sqlite3.Row
        try:
            yield cx
            cx.commit()
        finally:
            cx.close()

    # --- workbooks -----------------------------------------------------
    def save_workbook(self, wb: Workbook) -> None:
        # IMPORTANT: do NOT use INSERT OR REPLACE here. REPLACE deletes the
        # existing row first, which cascades through ON DELETE CASCADE on
        # proposals(workbook_id) — silently wiping every proposal attached
        # to the workbook. Use INSERT ... ON CONFLICT DO UPDATE instead.
        with self._conn() as cx:
            cx.execute(
                """
                INSERT INTO workbooks(id, name, owner, created_at, payload)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    owner = excluded.owner,
                    created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (wb.id, wb.name, wb.owner, wb.created_at, wb.model_dump_json()),
            )

    def get_workbook(self, workbook_id: str) -> Optional[Workbook]:
        with self._conn() as cx:
            row = cx.execute("SELECT payload FROM workbooks WHERE id = ?", (workbook_id,)).fetchone()
        return Workbook.model_validate_json(row["payload"]) if row else None

    def list_workbooks(self) -> list[Workbook]:
        with self._conn() as cx:
            rows = cx.execute("SELECT payload FROM workbooks ORDER BY created_at DESC").fetchall()
        return [Workbook.model_validate_json(r["payload"]) for r in rows]

    # --- proposals -----------------------------------------------------
    def save_proposal(self, proposal: Proposal) -> None:
        # See save_workbook for why this is INSERT...ON CONFLICT, not REPLACE.
        with self._conn() as cx:
            cx.execute(
                """
                INSERT INTO proposals(id, workbook_id, status, created_at, payload)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    workbook_id = excluded.workbook_id,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (proposal.id, proposal.workbook_id, proposal.status, proposal.created_at, proposal.model_dump_json()),
            )

    def get_proposal(self, proposal_id: str) -> Optional[Proposal]:
        with self._conn() as cx:
            row = cx.execute("SELECT payload FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
        return Proposal.model_validate_json(row["payload"]) if row else None

    def latest_proposal_for(self, workbook_id: str) -> Optional[Proposal]:
        with self._conn() as cx:
            row = cx.execute(
                "SELECT payload FROM proposals WHERE workbook_id = ? ORDER BY created_at DESC LIMIT 1",
                (workbook_id,),
            ).fetchone()
        return Proposal.model_validate_json(row["payload"]) if row else None

    def append_proposal_item(self, proposal_id: str, item: ProposalItem) -> Proposal:
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            raise KeyError(f"proposal {proposal_id} not found")
        proposal.items.append(item)
        self.save_proposal(proposal)
        return proposal

    def decide_item(
        self,
        proposal_id: str,
        item_id: str,
        decision: str,
        reviewer: str,
        comment: Optional[str] = None,
    ) -> Proposal:
        if decision not in ("approve", "reject"):
            raise ValueError("decision must be approve or reject")
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            raise KeyError(f"proposal {proposal_id} not found")
        for item in proposal.items:
            if item.id == item_id:
                item.status = "approved" if decision == "approve" else "rejected"
                item.reviewer = reviewer
                item.reviewed_at = _now()
                item.review_comment = comment
                sync_item_operation_status(item)
                break
        else:
            raise KeyError(f"item {item_id} not found in proposal {proposal_id}")
        self.save_proposal(proposal)
        return proposal

    def decide_all_pending(
        self,
        proposal_id: str,
        decision: str,
        reviewer: str,
        comment: Optional[str] = None,
    ) -> tuple[Proposal, list[str]]:
        if decision not in ("approve", "reject"):
            raise ValueError("decision must be approve or reject")
        proposal = self.get_proposal(proposal_id)
        if not proposal:
            raise KeyError(f"proposal {proposal_id} not found")
        new_status: str = "approved" if decision == "approve" else "rejected"
        flipped: list[str] = []
        now = _now()
        for item in proposal.items:
            if item.status == "pending":
                item.status = new_status  # type: ignore[assignment]
                item.reviewer = reviewer
                item.reviewed_at = now
                item.review_comment = comment
                sync_item_operation_status(item)
                flipped.append(item.id)
        self.save_proposal(proposal)
        return proposal, flipped

    # --- agent runs ----------------------------------------------------
    def save_agent_run(self, run: AgentRun) -> None:
        with self._conn() as cx:
            cx.execute(
                """
                INSERT INTO agent_runs(id, workbook_id, mode, status, started_at, payload)
                VALUES(?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    workbook_id = excluded.workbook_id,
                    mode = excluded.mode,
                    status = excluded.status,
                    started_at = excluded.started_at,
                    payload = excluded.payload
                """,
                (run.id, run.workbook_id, run.mode, run.status, run.started_at, run.model_dump_json()),
            )

    def get_agent_run(self, run_id: str) -> Optional[AgentRun]:
        with self._conn() as cx:
            row = cx.execute("SELECT payload FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
        return AgentRun.model_validate_json(row["payload"]) if row else None

    def list_agent_runs(self, workbook_id: str) -> list[AgentRun]:
        with self._conn() as cx:
            rows = cx.execute(
                "SELECT payload FROM agent_runs WHERE workbook_id = ? ORDER BY started_at ASC",
                (workbook_id,),
            ).fetchall()
        return [AgentRun.model_validate_json(r["payload"]) for r in rows]

    # --- audit ---------------------------------------------------------
    def append_audit(self, event: AuditEvent) -> None:
        with self._conn() as cx:
            cx.execute(
                "INSERT INTO audit_events(id, workbook_id, actor, action, detail, created_at) VALUES(?,?,?,?,?,?)",
                (event.id, event.workbook_id, event.actor, event.action, event.detail, event.created_at),
            )

    def list_audit(self, workbook_id: str) -> list[AuditEvent]:
        with self._conn() as cx:
            rows = cx.execute(
                "SELECT id, workbook_id, actor, action, detail, created_at FROM audit_events "
                "WHERE workbook_id = ? ORDER BY created_at ASC",
                (workbook_id,),
            ).fetchall()
        return [AuditEvent(**dict(r)) for r in rows]

    # --- snapshots -----------------------------------------------------
    def review_snapshot(self, workbook_id: str) -> Optional[ReviewSnapshot]:
        wb = self.get_workbook(workbook_id)
        if not wb:
            return None
        return ReviewSnapshot(
            workbook=wb,
            proposal=self.latest_proposal_for(workbook_id),
            audit_events=self.list_audit(workbook_id),
        )
