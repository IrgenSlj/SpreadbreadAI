import { useState } from "react";

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

const workbookRisks = [
  { label: "Broken formula chain", value: "3 cells" },
  { label: "External reference drift", value: "1 sheet" },
  { label: "Stale inputs", value: "2 regions" },
];

const auditEvents = [
  "Proposal created for Q2 forecast refresh",
  "Human reviewer rejected a range-level write",
  "Workbook snapshot version 14 stored",
  "AI comment appended to revenue assumptions",
];

function App() {
  const [section, setSection] = useState<Section>("workbook");

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
            <strong>Q2 Forecast</strong>
          </article>
          <article>
            <span>Proposals</span>
            <strong>4 pending</strong>
          </article>
          <article>
            <span>Audit</span>
            <strong>Append-only</strong>
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
          <section className="panel grid-two">
            <div>
              <p className="panel-kicker">Workbook Review</p>
              <h2>Review the workbook before any write is approved.</h2>
              <p>
                Sheet structure, formulas, and exception signals are shown together so a
                reviewer can decide what should happen next.
              </p>
            </div>
            <div className="risk-list">
              {workbookRisks.map((risk) => (
                <article key={risk.label}>
                  <span>{risk.label}</span>
                  <strong>{risk.value}</strong>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "proposal" && (
          <section className="panel proposal-grid">
            <div>
              <p className="panel-kicker">Proposal Review</p>
              <h2>Inspect the diff before the platform applies it.</h2>
              <p>Drafts stay in review mode until a human accepts the change.</p>
            </div>
            <div className="diff-card">
              <div className="diff-row removed">- Revenue assumption: 1.18</div>
              <div className="diff-row added">+ Revenue assumption: 1.24</div>
              <div className="diff-row neutral">Comment: aligns with revised pipeline data</div>
            </div>
          </section>
        )}

        {section === "audit" && (
          <section className="panel">
            <p className="panel-kicker">Audit Trail</p>
            <h2>Every action is logged with version and approval context.</h2>
            <div className="timeline">
              {auditEvents.map((event, index) => (
                <article key={event}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{event}</p>
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
                The canvas is the shared planning surface for humans and agents. It will
                connect ideas to workbook ranges, proposals, and approvals.
              </p>
            </div>
            <div className="sketch-canvas" aria-label="Sketchpad placeholder">
              <div className="node node-a">Assumptions</div>
              <div className="node node-b">Forecast</div>
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
