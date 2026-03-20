import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  type ApprovalDecision,
  demoReviewSnapshot,
  type ProposalDiffEntry,
  type WorkbookSummary,
  type WorkbookReviewSnapshot,
} from "../../../packages/shared/src/index";

type Section = "workbook" | "proposal" | "audit" | "sketch";

const sections: Array<{ id: Section; label: string; description: string }> = [
  {
    id: "workbook",
    label: "Workbook Review",
    description: "Inspect sheet structure, formulas, and risk signals.",
  },
  {
    id: "proposal",
    label: "Proposal Review",
    description: "Compare AI drafts, diffs, and approval requests.",
  },
  {
    id: "audit",
    label: "Audit Trail",
    description: "Trace actions, approvals, and workbook versions.",
  },
  {
    id: "sketch",
    label: "Sketchpad",
    description: "Map ideas and link them to workbook entities.",
  },
];

function diffClassName(kind: ProposalDiffEntry["kind"]) {
  switch (kind) {
    case "remove":
      return "removed";
    case "add":
      return "added";
    case "update":
      return "neutral";
    case "comment":
      return "comment";
    default:
      return "neutral";
  }
}

function itemStatusLabel(status: ProposalDiffEntry["status"]) {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

function App() {
  const [section, setSection] = useState<Section>("workbook");
  const [snapshot, setSnapshot] = useState<WorkbookReviewSnapshot>(demoReviewSnapshot);
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState("Finance Manager");
  const [reviewComment, setReviewComment] = useState("");

  const pendingRisks = useMemo(
    () => snapshot.workbook.risks.filter((risk) => risk.severity !== "low"),
    [snapshot],
  );
  const approvedItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status === "approved"),
    [snapshot],
  );
  const rejectedItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status === "rejected"),
    [snapshot],
  );
  const pendingItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status === "pending"),
    [snapshot],
  );

  useEffect(() => {
    void loadWorkbooks();
  }, []);

  async function loadWorkbooks(targetWorkbookId?: string) {
    try {
      setErrorMessage(null);
      const response = await fetch("/api/workbooks");

      if (!response.ok) {
        throw new Error(`Failed to load workbooks (${response.status})`);
      }

      const data = (await response.json()) as { workbooks: WorkbookSummary[] };
      setWorkbooks(data.workbooks);

      const workbookId =
        targetWorkbookId ?? data.workbooks[0]?.id ?? demoReviewSnapshot.workbook.id;

      await loadReview(workbookId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load workbook data";

      setErrorMessage(message);
      setWorkbooks([
        {
          id: demoReviewSnapshot.workbook.id,
          name: demoReviewSnapshot.workbook.name,
          latestVersionId: demoReviewSnapshot.workbook.latestVersionId,
          sheetCount: demoReviewSnapshot.workbook.sheetCount,
          createdAt: demoReviewSnapshot.workbook.createdAt,
        },
      ]);
      setSnapshot(demoReviewSnapshot);
    }
  }

  async function loadReview(workbookId: string) {
    const response = await fetch(`/api/workbooks/${encodeURIComponent(workbookId)}/review`);

    if (!response.ok) {
      throw new Error(`Failed to load workbook review (${response.status})`);
    }

    const data = (await response.json()) as { review: WorkbookReviewSnapshot };
    setSnapshot(data.review);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch("/api/workbooks/upload", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });

      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }

      const data = (await response.json()) as {
        workbookId: string;
        review: WorkbookReviewSnapshot;
      };

      setSnapshot(data.review);
      await loadWorkbooks(data.workbookId);
      setSection("workbook");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  }

  async function handleWorkbookSelect(workbookId: string) {
    try {
      setErrorMessage(null);
      setIsLoading(true);
      await loadReview(workbookId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to switch workbook";

      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleProposalDecision(decision: ApprovalDecision) {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(snapshot.workbook.id)}/proposal/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            reviewer: reviewerName,
            comment: reviewComment,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Proposal decision failed (${response.status})`);
      }

      const data = (await response.json()) as { review: WorkbookReviewSnapshot };
      setSnapshot(data.review);
      setSection("proposal");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update proposal decision";

      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleProposalItemDecision(
    diffId: string,
    decision: ApprovalDecision,
  ) {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(
          snapshot.workbook.id,
        )}/proposal/items/${encodeURIComponent(diffId)}/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            reviewer: reviewerName,
            comment: reviewComment,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Proposal item decision failed (${response.status})`);
      }

      const data = (await response.json()) as { review: WorkbookReviewSnapshot };
      setSnapshot(data.review);
      setSection("proposal");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update proposal item";

      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleApplyApprovedItems() {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(snapshot.workbook.id)}/proposal/apply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            actor: reviewerName,
            note: reviewComment,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Apply failed (${response.status})`);
      }

      const data = (await response.json()) as { review: WorkbookReviewSnapshot };
      setSnapshot(data.review);
      setSection("proposal");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply items";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SpreadbreadAI control room</p>
          <h1>Spreadsheet operations with review, approval, and traceability.</h1>
          <p className="lede">
            Built for teams that run the business in workbooks and want AI assistance
            without giving up human control.
          </p>
        </div>

        <div className="hero-metrics" aria-label="workspace metrics">
          <article>
            <span>Workbook</span>
            <strong>{snapshot.workbook.name}</strong>
          </article>
          <article>
            <span>Proposal</span>
            <strong>{snapshot.proposal.status.replaceAll("_", " ")}</strong>
          </article>
          <article>
            <span>Audit</span>
            <strong>{snapshot.auditEvents.length} events</strong>
          </article>
        </div>
      </header>

      <nav className="section-nav" aria-label="Primary sections">
        {sections.map((item) => (
          <button
            key={item.id}
            className={item.id === section ? "tab active" : "tab"}
            onClick={() => setSection(item.id)}
            type="button"
          >
            <span>{item.label}</span>
            <small>{item.description}</small>
          </button>
        ))}
      </nav>

      <main className="content">
        {section === "workbook" && (
          <>
            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Workbook Intake</p>
                <h2>Upload a workbook and seed a reviewable AI draft.</h2>
                <p>
                  This first slice uses a shared domain model for workbook metadata,
                  proposal diffs, and audit history. Uploading a file persists a
                  workbook record through the local API.
                </p>
                <label className="upload-control">
                  <span>Upload workbook</span>
                  <input accept=".xlsx,.xls,.csv" onChange={handleUpload} type="file" />
                </label>
                {isLoading ? <p className="status-note">Working on your request...</p> : null}
                {errorMessage ? <p className="status-note status-error">{errorMessage}</p> : null}
              </div>

              <div className="risk-list">
                <article>
                  <span>Version</span>
                  <strong>{snapshot.workbook.latestVersionId}</strong>
                </article>
                <article>
                  <span>Owner</span>
                  <strong>{snapshot.workbook.owner}</strong>
                </article>
                <article>
                  <span>Needs review</span>
                  <strong>{pendingRisks.length} active risks</strong>
                </article>
                <article>
                  <span>Named ranges</span>
                  <strong>{snapshot.workbook.namedRanges.length}</strong>
                </article>
              </div>
            </section>

            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Workbook Library</p>
                <h2>Switch between persisted review snapshots.</h2>
                <p>
                  Uploaded workbooks are stored locally and exposed back through the
                  review API and MCP read tools.
                </p>
              </div>
              <div className="workbook-list">
                {workbooks.map((workbook) => (
                  <button
                    key={workbook.id}
                    className={
                      workbook.id === snapshot.workbook.id
                        ? "workbook-item active"
                        : "workbook-item"
                    }
                    onClick={() => void handleWorkbookSelect(workbook.id)}
                    type="button"
                  >
                    <span>{workbook.name}</span>
                    <strong>{workbook.latestVersionId}</strong>
                    <small>{workbook.sheetCount} sheets</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Workbook Review</p>
                <h2>Review the workbook before any write is approved.</h2>
                <p>
                  Sheet structure, formulas, and exception signals are shown together so a
                  reviewer can decide what should happen next.
                </p>
              </div>
              <div className="sheet-list">
                {snapshot.workbook.sheets.map((sheet) => (
                  <article key={sheet.name}>
                    <span>{sheet.name}</span>
                    <strong>
                      {sheet.rows}x{sheet.columns}
                    </strong>
                    <small>
                      {sheet.formulaCells} formula cells, {sheet.populatedCells} populated cells,
                      {" "}
                      {sheet.riskCount} flagged risks
                    </small>
                    {sheet.sampleRows.length > 0 ? (
                      <div className="sample-block">
                        {sheet.sampleRows.map((row, index) => (
                          <code key={`${sheet.name}-${index}`}>{row.join(" | ")}</code>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Named Ranges</p>
                <h2>Expose reusable workbook anchors for future agent actions.</h2>
                <p>
                  Named ranges are important future handles for proposals, approvals, and
                  sketch-to-workbook links.
                </p>
              </div>
              <div className="named-range-list">
                {snapshot.workbook.namedRanges.length > 0 ? (
                  snapshot.workbook.namedRanges.map((namedRange) => (
                    <article key={namedRange.name}>
                      <span>{namedRange.name}</span>
                      <strong>{namedRange.reference}</strong>
                      <small>{namedRange.sheetName ?? "Workbook-level range"}</small>
                    </article>
                  ))
                ) : (
                  <article>
                    <span>No named ranges</span>
                    <strong>None detected</strong>
                    <small>This workbook currently exposes no reusable named range anchors.</small>
                  </article>
                )}
              </div>
            </section>

            <section className="panel">
              <p className="panel-kicker">Risk Summary</p>
              <h2>Flag the workbook areas that need human review.</h2>
              <div className="risk-grid">
                {snapshot.workbook.risks.map((risk) => (
                  <article key={risk.id} className="risk-card">
                    <span>{risk.location}</span>
                    <strong>{risk.label}</strong>
                    <small className={`severity severity-${risk.severity}`}>
                      {risk.severity} severity
                    </small>
                    <p>{risk.summary}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {section === "proposal" && (
          <section className="panel proposal-layout">
            <div>
              <p className="panel-kicker">Proposal Review</p>
              <h2>{snapshot.proposal.title}</h2>
              <p>{snapshot.proposal.summary}</p>
              <div className="proposal-meta">
                <article>
                  <span>Status</span>
                  <strong>{snapshot.proposal.status.replaceAll("_", " ")}</strong>
                </article>
                <article>
                  <span>Requested by</span>
                  <strong>{snapshot.proposal.requestedBy}</strong>
                </article>
                <article>
                  <span>Approval</span>
                  <strong>{snapshot.proposal.approvalRequired ? "Required" : "Optional"}</strong>
                </article>
                <article>
                  <span>Actions</span>
                  <strong>{snapshot.proposal.diff.length} proposed review actions</strong>
                </article>
                <article>
                  <span>Approved</span>
                  <strong>{approvedItems.length}</strong>
                </article>
                <article>
                  <span>Pending</span>
                  <strong>{pendingItems.length}</strong>
                </article>
                <article>
                  <span>Rejected</span>
                  <strong>{rejectedItems.length}</strong>
                </article>
              </div>
              <div className="review-form">
                <label>
                  <span>Reviewer</span>
                  <input
                    onChange={(event) => setReviewerName(event.target.value)}
                    type="text"
                    value={reviewerName}
                  />
                </label>
                <label>
                  <span>Decision comment</span>
                  <textarea
                    onChange={(event) => setReviewComment(event.target.value)}
                    rows={3}
                    value={reviewComment}
                  />
                </label>
                <div className="action-row">
                  <button
                    className="decision-button approve"
                    onClick={() => void handleProposalDecision("approve")}
                    type="button"
                  >
                    Approve Proposal
                  </button>
                  <button
                    className="decision-button reject"
                    onClick={() => void handleProposalDecision("reject")}
                    type="button"
                  >
                    Reject Proposal
                  </button>
                  <button
                    className="decision-button apply"
                    disabled={approvedItems.length === 0 || snapshot.proposal.status === "applied"}
                    onClick={() => void handleApplyApprovedItems()}
                    type="button"
                  >
                    Apply Approved Items
                  </button>
                </div>
                {snapshot.proposal.reviewer ? (
                  <p className="review-meta">
                    Reviewed by {snapshot.proposal.reviewer}
                    {snapshot.proposal.reviewedAt
                      ? ` at ${new Date(snapshot.proposal.reviewedAt).toLocaleString()}`
                      : ""}
                    {snapshot.proposal.reviewComment
                      ? `: ${snapshot.proposal.reviewComment}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="diff-card">
              {snapshot.proposal.diff.map((entry) => (
                <article key={entry.id} className="diff-entry">
                  <div className="diff-header">
                    <span>{entry.cell}</span>
                    <small>{entry.kind}</small>
                  </div>
                  <div className="item-status-row">
                    <span className={`item-status status-${entry.status}`}>
                      {itemStatusLabel(entry.status)}
                    </span>
                    <div className="item-action-row">
                      <button
                        className="mini-button approve"
                        onClick={() => void handleProposalItemDecision(entry.id, "approve")}
                        type="button"
                      >
                        Approve Item
                      </button>
                      <button
                        className="mini-button reject"
                        onClick={() => void handleProposalItemDecision(entry.id, "reject")}
                        type="button"
                      >
                        Reject Item
                      </button>
                    </div>
                  </div>
                  {entry.before ? (
                    <div className={`diff-row ${diffClassName(entry.kind)}`}>- {entry.before}</div>
                  ) : null}
                  {entry.after ? (
                    <div className={`diff-row ${diffClassName(entry.kind)}`}>
                      {entry.kind === "comment" ? entry.after : `+ ${entry.after}`}
                    </div>
                  ) : null}
                  <div className="diff-row neutral">{entry.rationale}</div>
                  {entry.reviewer ? (
                    <div className="item-meta">
                      {entry.reviewer}
                      {entry.reviewedAt
                        ? ` at ${new Date(entry.reviewedAt).toLocaleString()}`
                        : ""}
                      {entry.reviewComment ? `: ${entry.reviewComment}` : ""}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "audit" && (
          <section className="panel">
            <p className="panel-kicker">Audit Trail</p>
            <h2>Every action is logged with version and approval context.</h2>
            <div className="timeline">
              {snapshot.auditEvents.map((event) => (
                <article key={event.id}>
                  <span>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <p>
                    <strong>{event.action}</strong>
                    <br />
                    {event.detail}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "sketch" && (
          <section className="panel sketch-panel">
            <div>
              <p className="panel-kicker">Sketchpad</p>
              <h2>Sketch workflows, link them to sheets, and let AI draft structure.</h2>
              <p>
                The canvas is the shared planning surface for humans and agents. In the
                next phase it will attach nodes directly to workbook ranges and proposal
                objects.
              </p>
              <div className="link-list">
                <article>
                  <span>Linked workbook</span>
                  <strong>{snapshot.workbook.name}</strong>
                </article>
                <article>
                  <span>Linked proposal</span>
                  <strong>{snapshot.proposal.id}</strong>
                </article>
              </div>
            </div>
            <div className="sketch-canvas" aria-label="Sketchpad placeholder">
              <div className="node node-a">{snapshot.workbook.sheets[0]?.name ?? "Inputs"}</div>
              <div className="node node-b">{snapshot.workbook.sheets[1]?.name ?? "Model"}</div>
              <div className="node node-c">Approval</div>
              <div className="connector connector-a" />
              <div className="connector connector-b" />
            </div>
          </section>
        )}

        {(section === "workbook" || section === "proposal") && (
          <section className="panel">
            <p className="panel-kicker">Workbook Versions</p>
            <h2>Track the version history created by uploads and apply actions.</h2>
            <div className="version-list">
              {snapshot.workbook.versions.map((version) => (
                <article key={version.id}>
                  <span>{version.id}</span>
                  <strong>{version.note}</strong>
                  <small>
                    {version.createdBy} at {new Date(version.createdAt).toLocaleString()}
                  </small>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
