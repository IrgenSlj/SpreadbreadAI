import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
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

function App() {
  const [section, setSection] = useState<Section>("workbook");
  const [snapshot, setSnapshot] = useState<WorkbookReviewSnapshot>(demoReviewSnapshot);
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pendingRisks = useMemo(
    () => snapshot.workbook.risks.filter((risk) => risk.severity !== "low"),
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
                      {sheet.formulaCells} formula cells, {sheet.riskCount} flagged risks
                    </small>
                  </article>
                ))}
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
              </div>
            </div>
            <div className="diff-card">
              {snapshot.proposal.diff.map((entry) => (
                <article key={entry.id} className="diff-entry">
                  <div className="diff-header">
                    <span>{entry.cell}</span>
                    <small>{entry.kind}</small>
                  </div>
                  {entry.before ? (
                    <div className={`diff-row ${diffClassName(entry.kind)}`}>- {entry.before}</div>
                  ) : null}
                  {entry.after ? (
                    <div className={`diff-row ${diffClassName(entry.kind)}`}>+ {entry.after}</div>
                  ) : null}
                  <div className="diff-row neutral">{entry.rationale}</div>
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
      </main>
    </div>
  );
}

export default App;
