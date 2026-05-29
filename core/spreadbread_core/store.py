from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from .domain import (
    AgentRun,
    ArtifactFinding,
    ArtifactImpact,
    ArtifactOperation,
    ArtifactTimelineEntry,
    AuditEvent,
    Operation,
    OperationValidation,
    Proposal,
    ProposalItem,
    Resource,
    ReviewSnapshot,
    RunArtifacts,
    RunEvent,
    Workbook,
    _now,
    sync_item_operation_status,
)
from .validators import validate_operation

SCHEMA = """
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    external_id TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources_provider ON resources(provider_id, resource_kind);
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
CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'local_xlsx',
    resource_kind TEXT NOT NULL DEFAULT 'spreadsheet',
    kind TEXT NOT NULL,
    target_sheet TEXT,
    target_cell TEXT,
    target_range TEXT,
    target_path TEXT,
    before TEXT NOT NULL DEFAULT '{}',
    after TEXT NOT NULL DEFAULT '{}',
    rationale TEXT NOT NULL DEFAULT '',
    risk TEXT NOT NULL DEFAULT 'medium',
    required_capability TEXT NOT NULL DEFAULT '',
    validation_status TEXT NOT NULL DEFAULT 'not_validated',
    validation_messages TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    approval_status TEXT NOT NULL DEFAULT 'pending',
    source_run_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operations_resource ON operations(resource_id, status);
CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);
CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at);
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

    # --- resources -----------------------------------------------------
    def save_resource(self, res: Resource) -> None:
        with self._conn() as cx:
            cx.execute(
                """
                INSERT INTO resources(id, provider_id, resource_kind, external_id, name, created_at, payload)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    provider_id = excluded.provider_id,
                    resource_kind = excluded.resource_kind,
                    external_id = excluded.external_id,
                    name = excluded.name,
                    created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (res.id, res.provider_id, res.resource_kind, res.external_id,
                 res.name, res.created_at, res.model_dump_json()),
            )

    def get_resource(self, resource_id: str) -> Optional[Resource]:
        with self._conn() as cx:
            row = cx.execute("SELECT payload FROM resources WHERE id = ?", (resource_id,)).fetchone()
        return Resource.model_validate_json(row["payload"]) if row else None

    def list_resources(self, provider_id: Optional[str] = None) -> list[Resource]:
        with self._conn() as cx:
            if provider_id:
                rows = cx.execute(
                    "SELECT payload FROM resources WHERE provider_id = ? ORDER BY created_at DESC",
                    (provider_id,),
                ).fetchall()
            else:
                rows = cx.execute("SELECT payload FROM resources ORDER BY created_at DESC").fetchall()
        return [Resource.model_validate_json(r["payload"]) for r in rows]

    def delete_resource(self, resource_id: str) -> None:
        with self._conn() as cx:
            cx.execute("DELETE FROM resources WHERE id = ?", (resource_id,))

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

    def delete_workbook(self, workbook_id: str) -> None:
        with self._conn() as cx:
            cx.execute("DELETE FROM workbooks WHERE id = ?", (workbook_id,))

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

    def _sync_operation(self, item: ProposalItem) -> None:
        if item.operation is not None:
            self.save_operation(item.operation)

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
                self._sync_operation(item)
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
                self._sync_operation(item)
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

    # --- run events ----------------------------------------------------
    def append_run_event(self, event: RunEvent) -> None:
        with self._conn() as cx:
            cx.execute(
                """
                INSERT INTO run_events(id, run_id, kind, detail, payload, created_at)
                VALUES(?, ?, ?, ?, ?, ?)
                """,
                (event.id, event.run_id, event.kind, event.detail,
                 event.model_dump_json(include={"payload"}), event.created_at),
            )

    def list_run_events(self, run_id: str) -> list[RunEvent]:
        import json

        with self._conn() as cx:
            rows = cx.execute(
                "SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC",
                (run_id,),
            ).fetchall()
        result: list[RunEvent] = []
        for r in rows:
            payload = {}
            try:
                payload = json.loads(r["payload"]).get("payload", {})
            except (json.JSONDecodeError, TypeError):
                pass
            result.append(
                RunEvent(
                    id=r["id"],
                    run_id=r["run_id"],
                    kind=r["kind"],
                    detail=r["detail"],
                    payload=payload,
                    created_at=r["created_at"],
                )
            )
        return result

    # --- operations ----------------------------------------------------
    def save_operation(self, op: Operation) -> None:
        import json

        with self._conn() as cx:
            cx.execute(
                """
                INSERT INTO operations(
                    id, resource_id, provider_id, resource_kind, kind,
                    target_sheet, target_cell, target_range, target_path,
                    before, after, rationale, risk, required_capability,
                    validation_status, validation_messages,
                    status, approval_status, source_run_id, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    resource_id = excluded.resource_id,
                    provider_id = excluded.provider_id,
                    resource_kind = excluded.resource_kind,
                    kind = excluded.kind,
                    target_sheet = excluded.target_sheet,
                    target_cell = excluded.target_cell,
                    target_range = excluded.target_range,
                    target_path = excluded.target_path,
                    before = excluded.before,
                    after = excluded.after,
                    rationale = excluded.rationale,
                    risk = excluded.risk,
                    required_capability = excluded.required_capability,
                    validation_status = excluded.validation_status,
                    validation_messages = excluded.validation_messages,
                    status = excluded.status,
                    approval_status = excluded.approval_status,
                    source_run_id = excluded.source_run_id,
                    updated_at = excluded.updated_at
                """,
                (
                    op.id, op.resource_id or "", op.provider_id, op.resource_kind, op.kind,
                    op.target.sheet, op.target.cell, op.target.range, op.target.path,
                    json.dumps(op.before), json.dumps(op.after),
                    op.rationale, op.risk, op.required_capability,
                    op.validation.status, json.dumps(op.validation.messages),
                    op.status, op.approval_status, op.source_run_id,
                    _now(), _now(),
                ),
            )

    def get_operation(self, operation_id: str) -> Optional[Operation]:
        with self._conn() as cx:
            row = cx.execute("SELECT * FROM operations WHERE id = ?", (operation_id,)).fetchone()
        if not row:
            return None
        return self._row_to_operation(row)

    def list_operations(
        self,
        resource_id: Optional[str] = None,
        status: Optional[str] = None,
        kind: Optional[str] = None,
        limit: int = 100,
    ) -> list[Operation]:
        clauses: list[str] = []
        params: list[str] = []
        if resource_id is not None:
            clauses.append("resource_id = ?")
            params.append(resource_id)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        where = " AND ".join(clauses) if clauses else "1"
        with self._conn() as cx:
            rows = cx.execute(
                f"SELECT * FROM operations WHERE {where} ORDER BY created_at DESC LIMIT ?",
                [*params, str(limit)],
            ).fetchall()
        return [self._row_to_operation(r) for r in rows]

    def delete_operation(self, operation_id: str) -> None:
        with self._conn() as cx:
            cx.execute("DELETE FROM operations WHERE id = ?", (operation_id,))

    def validate_and_save_operation(
        self,
        op: Operation,
        dependencies: Optional[dict[str, list[str]]] = None,
        known_sheets: Optional[list[str]] = None,
    ) -> Operation:
        if op.kind == "set_cell_formula":
            op.validation = validate_operation(
                op,
                dependencies or {},
                known_sheets or [],
            )
        else:
            op.validation = OperationValidation(status="valid")
        op.status = "valid" if op.validation.status == "valid" else "invalid"
        self.save_operation(op)
        return op

    def transition_operation(
        self, operation_id: str, new_status: str
    ) -> Operation:
        op = self.get_operation(operation_id)
        if not op:
            raise KeyError(f"operation {operation_id} not found")
        allowed: dict[str, list[str]] = {
            "draft": ["valid", "invalid"],
            "valid": ["pending", "invalid"],
            "invalid": ["draft"],
            "pending": ["approved", "rejected"],
            "approved": ["applied", "pending"],
            "rejected": ["pending"],
            "applied": [],
            "failed": ["draft"],
        }
        permitted = allowed.get(op.status, [])
        if new_status not in permitted:
            raise ValueError(
                f"Cannot transition operation {operation_id} from {op.status!r} to {new_status!r}. "
                f"Allowed: {permitted}"
            )
        op.status = new_status  # type: ignore[assignment]
        if new_status in ("approved", "rejected"):
            op.approval_status = new_status  # type: ignore[assignment]
        self.save_operation(op)
        return op

    @staticmethod
    def _row_to_operation(row: sqlite3.Row) -> Operation:
        import json
        from .domain import OperationTarget, OperationValidation

        target = OperationTarget(
            sheet=row["target_sheet"],
            cell=row["target_cell"],
            range=row["target_range"],
            path=row["target_path"],
        )

        def _safe_json(raw: str, default: Any) -> Any:
            try:
                return json.loads(raw) if raw else default
            except (json.JSONDecodeError, TypeError):
                return default

        return Operation(
            id=row["id"],
            resource_id=row["resource_id"] or None,
            provider_id=row["provider_id"],
            resource_kind=row["resource_kind"],
            kind=row["kind"],
            target=target,
            before=_safe_json(row["before"], {}),
            after=_safe_json(row["after"], {}),
            rationale=row["rationale"],
            risk=row["risk"],
            required_capability=row["required_capability"],
            validation=OperationValidation(
                status=row["validation_status"],
                messages=_safe_json(row["validation_messages"], []),
            ),
            status=row["status"],
            approval_status=row["approval_status"],
            source_run_id=row["source_run_id"],
        )

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

    # --- artifacts -----------------------------------------------------
    def build_artifacts(self, run: AgentRun) -> Optional[RunArtifacts]:
        """Assemble RunArtifacts for a completed run by aggregating
        workbook, proposal, operations, events, and audit data."""
        wb = self.get_workbook(run.workbook_id)
        if not wb:
            return None

        findings = [
            ArtifactFinding(
                id=r.id,
                severity=r.severity,
                location=r.location,
                summary=r.summary,
                detail=r.label,
            )
            for r in wb.risks
        ]

        operations: list[ArtifactOperation] = []
        proposal = self.latest_proposal_for(run.workbook_id)
        if proposal:
            for item in proposal.items:
                if item.operation:
                    op = item.operation
                    operations.append(
                        ArtifactOperation(
                            id=op.id,
                            kind=op.kind,
                            target=_artifact_target(op),
                            before=op.before.get("value") or op.before.get("formula") or op.before.get("comment"),
                            after=op.after.get("value") or op.after.get("formula") or op.after.get("comment"),
                            rationale=op.rationale,
                            risk=op.risk,
                            status=op.status,
                            validation=op.validation.status,
                        )
                    )
                else:
                    operations.append(
                        ArtifactOperation(
                            id=item.id,
                            kind="set_cell_value",
                            target=item.cell,
                            before=item.before,
                            after=item.after,
                            rationale=item.rationale,
                            risk="medium",
                            status=item.status,
                            validation="not_validated",
                        )
                    )

        events = self.list_run_events(run.id)
        timeline = [
            ArtifactTimelineEntry(
                id=e.id,
                kind=e.kind,
                detail=e.detail,
                created_at=e.created_at,
                payload=e.payload,
            )
            for e in events
        ]

        dependency_impact = [
            ArtifactImpact(cell=cell, dependents=deps)
            for cell, deps in wb.dependencies.items()
        ]

        return RunArtifacts(
            run_id=run.id,
            workbook_id=run.workbook_id,
            workbook_name=wb.name,
            latest_proposal_id=proposal.id if proposal else None,
            prompt=run.prompt,
            mode=run.mode,
            model=run.model,
            status=run.status,
            started_at=run.started_at,
            completed_at=run.completed_at,
            summary=run.summary,
            findings=findings,
            operations=operations,
            timeline=timeline,
            dependency_impact=dependency_impact,
            tool_calls=run.tool_calls,
            proposals_created=run.proposals_created,
            items_decided=run.items_decided,
        )

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


def _artifact_target(op: Operation) -> str:
    parts = []
    if op.target.sheet:
        parts.append(op.target.sheet)
    if op.target.cell:
        parts.append(op.target.cell)
    elif op.target.range:
        parts.append(op.target.range)
    return "!".join(parts)
