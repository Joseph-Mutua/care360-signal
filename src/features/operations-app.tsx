"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  Filter,
  HeartPulse,
  Info,
  Layers3,
  Search,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { analyze } from "../domain/analyze";
import { RULES } from "../config/rules";
import { displayTime } from "../parsers/whatsapp";
import type {
  Aggregate,
  Analysis,
  ExpectedSlot,
  Report,
} from "../domain/types";

type View = "overview" | "reports" | "escalations" | "quality" | "performance";
type Evidence = { reportId?: string; slotId?: string; messageId?: string };

const KPI = [
  [
    "Reporting completion",
    "Unique active scheduled slots with at least one report ÷ all active scheduled slots. Paused slots excluded.",
  ],
  [
    "On-time reporting",
    "Active scheduled slots whose first report arrived within ±30 minutes of due time ÷ all active scheduled slots.",
  ],
  [
    "Complete vitals",
    "Unique received scheduled reports containing BP, pulse, Celsius temperature and SpO₂ ÷ all unique received scheduled reports.",
  ],
  [
    "Escalation SLA",
    "Valid abnormal reports with supervisor tagged and a matched supervisor response within 15 minutes of the report ÷ all valid abnormal reports.",
  ],
  [
    "Data quality exceptions",
    "Unique received scheduled reports with at least one data-quality flag ÷ all unique received scheduled reports.",
  ],
] as const;
const tabs: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Ops 2-Min", icon: Activity },
  { id: "reports", label: "Vitals Log", icon: HeartPulse },
  { id: "escalations", label: "Escalations", icon: AlertTriangle },
  { id: "quality", label: "Data Trust", icon: ShieldCheck },
  { id: "performance", label: "Performance", icon: Layers3 },
];
const pct = (n: number, d: number) =>
  d ? `${((n / d) * 100).toFixed(1)}%` : "—";
const localDate = (at: number) => new Date(at).toISOString().slice(0, 10);

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "teal" | "red" | "amber" | "blue";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function OperationsApp() {
  const [data, setData] = useState<Analysis | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [view, setView] = useState<View>("overview");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [clientFilter, setClientFilter] = useState("all");
  const [caregiverFilter, setCaregiverFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<keyof Aggregate>("name");
  const inputRef = useRef<HTMLInputElement>(null);
  const sampleLoaded = useRef(false);

  const importText = useCallback((text: string, name: string) => {
    try {
      const next = analyze(text);
      if (!next.messages.length)
        throw new Error(
          "No WhatsApp messages were recognized. Check the export format.",
        );
      setData(next);
      setDatasetName(name);
      setError("");
      setView("overview");
      setPage(0);
      setEvidence(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The export could not be analyzed.",
      );
    } finally {
      setBusy(false);
    }
  }, []);


  const loadSample = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/sample.txt");
      if (!response.ok) throw new Error("Sample export unavailable.");
      importText(await response.text(), "Supplied sample export");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load sample.",
      );
      setBusy(false);
    }
  }, [importText]);
  useEffect(() => {
    if (sampleLoaded.current) return;
    sampleLoaded.current = true;
    fetch("/sample.txt")
      .then((response) => {
        if (!response.ok) throw new Error("Sample export unavailable.");
        return response.text();
      })
      .then((text) => importText(text, "Supplied sample export"))
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Could not load sample.",
        ),
      );
  }, [importText]);
  const importFile = useCallback(
    (file?: File) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".txt") || file.size > 5_000_000) {
        setError("Choose a .txt WhatsApp export under 5 MB.");
        return;
      }
      setBusy(true);
      setError("");
      const reader = new FileReader();
      reader.onload = () => importText(String(reader.result ?? ""), file.name);
      reader.onerror = () => {
        setBusy(false);
        setError("The file could not be read.");
      };
      reader.readAsText(file);
    },
    [importText],
  );
  const filtered = useMemo(
    () =>
      (data?.reports ?? []).filter((r) => {
        const raw =
          data?.messages.find((m) => m.id === r.messageId)?.text ?? "";
        return (
          (clientFilter === "all" || r.client === clientFilter) &&
          (caregiverFilter === "all" || r.sender === caregiverFilter) &&
          (shiftFilter === "all" || r.shift === shiftFilter) &&
          (!dateFilter || localDate(r.sentAt) === dateFilter) &&
          (statusFilter === "all" ||
            (statusFilter === "abnormal" && r.abnormal.length > 0) ||
            (statusFilter === "late" &&
              (r.minutesFromDue ?? -Infinity) > RULES.onTimeMinutes) ||
            (statusFilter === "early" &&
              (r.minutesFromDue ?? Infinity) < -RULES.onTimeMinutes) ||
            (statusFilter === "quality" && r.flags.length > 0) ||
            (statusFilter === "incomplete" && !r.complete) ||
            (statusFilter === "unmatched" && !r.slotId)) &&
          (!search ||
            `${r.client} ${r.sender} ${raw} ${r.flags.join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase()))
        );
      }),
    [
      data,
      clientFilter,
      caregiverFilter,
      shiftFilter,
      dateFilter,
      statusFilter,
      search,
    ],
  );
  const selectedReport = data?.reports.find((r) => r.id === evidence?.reportId);
  const selectedSlot = data?.slots.find((s) => s.id === evidence?.slotId);
  const selectedMessage = data?.messages.find(
    (m) => m.id === (selectedReport?.messageId ?? evidence?.messageId),
  );
  const exportCsv = () => {
    if (!data) return;
    const cols = [
      "report ID",
      "date",
      "send time",
      "due datetime",
      "client",
      "caregiver",
      "shift",
      "slot",
      "BP systolic",
      "BP diastolic",
      "pulse",
      "temperature",
      "temperature unit",
      "SpO2",
      "narrative",
      "minutes from due",
      "on time",
      "complete",
      "abnormal",
      "escalation status",
      "tagged",
      "supervisor response minutes",
      "data quality flags",
      "duplicate of",
      "raw message ID",
    ];

    const rows = data.reports.map((r) => [
      r.id,
      localDate(r.sentAt),
      displayTime(r.sentAt),
      r.due ? displayTime(r.due) : "",
      r.client,
      r.sender,
      r.shift ?? "",
      r.statedTime ?? "",
      r.vitals.systolic ?? "",
      r.vitals.diastolic ?? "",
      r.vitals.pulse ?? "",
      r.vitals.temperature ?? "",
      r.vitals.temperatureUnit ?? "",
      r.vitals.spo2 ?? "",
      r.narrative,
      r.minutesFromDue ?? "",
      r.onTime ?? "",
      r.complete,
      r.abnormal.join("; "),
      r.escalation,
      r.tagged,
      r.supervisorMinutes ?? "",
      r.flags.join("; "),
      r.duplicateOf ?? "",
      r.messageId,
    ]);
    const csv = [cols, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "care360-reports.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={20} />
          </div>
          <div>
            <strong>
              CARE360 <span>SIGNAL</span>
            </strong>
            <small>Homecare operations control</small>
          </div>
        </div>
        <div className="top-meta">
          <span className="live-dot" /> <span>7–20 Sep 2026</span>
          <Badge tone="teal">LOCAL ANALYSIS</Badge>
          <a href="/analysis" className="text-link">
            Executive report <ArrowRight size={14} />
          </a>
        </div>
      </header>
      <main className="workspace">
        <div className="section-head">
          <div>
            <div className="eyebrow">
              XALCO LTD / CARE360 · OPERATIONS INTELLIGENCE
            </div>
            <h1>
              {view === "overview"
                ? "Operations view"
                : tabs.find((t) => t.id === view)?.label}
            </h1>
            <p>
              Turn caregiver messages into actionable, source-linked reporting
              and clinical exceptions.
            </p>
          </div>
          <div className="head-actions">
            <button
              className="button secondary"
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud size={16} /> Import export
            </button>
            <button
              className="button ghost"
              onClick={exportCsv}
              disabled={!data}
            >
              <Download size={16} /> CSV
            </button>
          </div>
        </div>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => {
            importFile(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <div
          className={`upload-strip ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            importFile(e.dataTransfer.files[0]);
          }}
        >
          <div className="upload-icon">
            <UploadCloud size={20} />
          </div>
          <div>
            <strong>
              {busy
                ? "Analyzing messages…"
                : datasetName || "Drop a WhatsApp .txt export here"}
            </strong>
            <span>
              Processed locally in your browser — this file is not uploaded.{" "}
              {data &&
                `${data.messages.length} messages · ${data.reports.length} parsed reports`}
            </span>
          </div>
          <div className="upload-actions">
            <button onClick={() => void loadSample()}>Load sample</button>
            <button
              onClick={() => {
                setData(null);
                setDatasetName("");
                setError("");
              }}
            >
              Reset dataset
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="notice error">
            <AlertTriangle size={17} />
            {error}
          </div>
        )}
        <nav className="tab-nav" aria-label="Operations views">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? "active" : ""}
              onClick={() => {
                setView(t.id);
                setPage(0);
              }}
            >
              <t.icon size={17} />
              {t.label}
            </button>
          ))}
        </nav>
        {!data ? (
          <section className="empty-state">
            <UploadCloud size={38} />
            <h2>Import a reporting export</h2>
            <p>
              Choose a .txt file or load the supplied sample to see the
              operations view.
            </p>
            <button
              className="button primary"
              onClick={() => void loadSample()}
            >
              Load sample data
            </button>
          </section>
        ) : (
          <>
            {view === "overview" && (
              <Overview data={data} onEvidence={setEvidence} onView={setView} />
            )}
            {view === "reports" && (
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <div className="eyebrow">
                      INGESTION STREAM / AUDIT READY
                    </div>
                    <h2>Field vitals log</h2>
                    <p>
                      {filtered.length} matching reports ·{" "}
                      {
                        data.slots.filter((s) => !s.paused && !s.reportId)
                          .length
                      }{" "}
                      missing scheduled slots shown separately
                    </p>
                  </div>
                  <Filter size={20} />
                </div>
                <div className="filters">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search reports"
                      placeholder="Search report, sender, raw message…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(0);
                      }}
                    />
                  </label>
                  <select
                    aria-label="Client"
                    value={clientFilter}
                    onChange={(e) => {
                      setClientFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All clients</option>
                    {data.clients.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Caregiver"
                    value={caregiverFilter}
                    onChange={(e) => {
                      setCaregiverFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All caregivers</option>
                    {[...new Set(data.reports.map((r) => r.sender))]
                      .sort()
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </select>
                  <select
                    aria-label="Shift"
                    value={shiftFilter}
                    onChange={(e) => {
                      setShiftFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All shifts</option>
                    <option value="day">Day</option>
                    <option value="night">Night</option>
                  </select>
                  <select
                    aria-label="Status"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="all">All statuses</option>
                    <option value="abnormal">Abnormal</option>
                    <option value="late">Late</option>
                    <option value="early">Too early</option>
                    <option value="quality">Data quality</option>
                    <option value="incomplete">Incomplete</option>
                    <option value="unmatched">Unmatched</option>
                  </select>
                  <input
                    aria-label="Date"
                    type="date"
                    value={dateFilter}
                    onChange={(e) => {
                      setDateFilter(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Client / caregiver</th>
                        <th>Slot</th>
                        <th>Vitals</th>
                        <th>Outcome</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(page * 30, (page + 1) * 30).map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{displayTime(r.sentAt)}</strong>
                            <small>
                              Line{" "}
                              {
                                data.messages.find((m) => m.id === r.messageId)
                                  ?.line
                              }{" "}
                              · {r.id}
                            </small>
                          </td>
                          <td>
                            <strong>{r.client}</strong>
                            <small>
                              {r.sender} · {r.shift ?? "Unmatched"}
                            </small>
                          </td>
                          <td>
                            <strong>{r.statedTime}</strong>
                            <small>
                              {r.minutesFromDue === undefined
                                ? "No expected slot"
                                : `${r.minutesFromDue >= 0 ? "+" : ""}${r.minutesFromDue} min from due`}
                            </small>
                          </td>
                          <td className="mono">
                            {r.vitals.systolic ?? "—"}/
                            {r.vitals.diastolic ?? "—"}{" "}
                            <span>· P {r.vitals.pulse ?? "—"}</span>
                            <small>
                              T {r.vitals.temperature ?? "—"}
                              {r.vitals.temperatureUnit === "F" ? "°F" : "°C"} ·
                              SpO₂ {r.vitals.spo2 ?? "—"}%
                            </small>
                          </td>
                          <td>
                            <Badge
                              tone={
                                r.dataIntegrityCritical || r.abnormal.length
                                  ? "red"
                                  : r.flags.length
                                    ? "amber"
                                    : "teal"
                              }
                            >
                              {r.dataIntegrityCritical
                                ? "Validate"
                                : r.abnormal.length
                                  ? "Abnormal"
                                  : r.flags.length
                                    ? "Quality flag"
                                    : "Normal"}
                            </Badge>
                            <small>
                              {r.duplicateOf
                                ? "Duplicate"
                                : r.onTime
                                  ? "On time"
                                  : (r.minutesFromDue ?? 0) <
                                      -RULES.onTimeMinutes
                                    ? "Too early"
                                    : r.minutesFromDue !== undefined
                                      ? "Late"
                                      : "Unmatched"}
                            </small>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Inspect ${r.id}`}
                              onClick={() => setEvidence({ reportId: r.id })}
                            >
                              <ChevronRight size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pagination">
                  <span>
                    Showing {filtered.length ? page * 30 + 1 : 0}–
                    {Math.min((page + 1) * 30, filtered.length)} of{" "}
                    {filtered.length}
                  </span>
                  <div>
                    <button disabled={!page} onClick={() => setPage(page - 1)}>
                      Previous
                    </button>
                    <button
                      disabled={(page + 1) * 30 >= filtered.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
                <details className="missing-list">
                  <summary>
                    {data.missing} missing scheduled reports · inspect exact
                    expected slots
                  </summary>
                  <div className="missing-grid">
                    {data.slots
                      .filter((s) => !s.paused && !s.reportId)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setEvidence({ slotId: s.id })}
                        >
                          {s.client} · {displayTime(s.due)} · {s.caregiver}{" "}
                          <ChevronRight size={14} />
                        </button>
                      ))}
                  </div>
                </details>
              </section>
            )}
            {view === "escalations" && (
              <Escalations data={data} onEvidence={setEvidence} />
            )}
            {view === "quality" && (
              <Quality data={data} onEvidence={setEvidence} />
            )}
            {view === "performance" && (
              <Performance data={data} sort={sort} onSort={setSort} />
            )}
          </>
        )}
        <footer className="footer">
          <span>
            CARE360 SIGNAL · deterministic rules · browser-local assessment
            prototype
          </span>
          <span>
            <a href="/analysis">Analysis</a>
            <a href="/team-plan">Team plan</a>
          </span>
        </footer>
      </main>
      <nav className="mobile-nav" aria-label="Mobile operations views">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={view === t.id ? "active" : ""}
            onClick={() => setView(t.id)}
          >
            <t.icon size={19} />
            <span>{t.label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>
      {evidence && data && (
        <div className="drawer-backdrop" onMouseDown={() => setEvidence(null)}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Source evidence"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <div>
                <div className="eyebrow">SOURCE-LINKED DECISION</div>
                <h2>Audit evidence</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close evidence"
                onClick={() => setEvidence(null)}
              >
                <X size={20} />
              </button>
            </div>
            {selectedReport ? (
              <EvidenceReport report={selectedReport} data={data} />
            ) : selectedSlot ? (
              <EvidenceSlot slot={selectedSlot} data={data} />
            ) : selectedMessage ? (
              <>
                <h3>Original WhatsApp message</h3>
                <RawBlock message={selectedMessage} />
              </>
            ) : (
              <p>Evidence reference unavailable.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  count,
  definition,
  tone = "teal",
}: {
  label: string;
  value: string;
  count: string;
  definition: string;
  tone?: "teal" | "red" | "amber" | "blue";
}) {
  return (
    <article className={`metric ${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <details>
          <summary aria-label={`Definition of ${label}`}>
            <Info size={15} />
          </summary>
          <div className="tooltip">{definition}</div>
        </details>
      </div>
      <strong>{value}</strong>
      <small>{count}</small>
    </article>
  );
}

function Overview({
  data,
  onEvidence,
  onView,
}: {
  data: Analysis;
  onEvidence: (e: Evidence) => void;
  onView: (v: View) => void;
}) {
  const active = data.slots.filter((s) => !s.paused);
  const onTimeCount = active.filter(
    (s) => data.reports.find((r) => r.id === s.reportId)?.onTime,
  ).length;
  const critical = data.actions.filter((a) => a.severity === "critical");
  return (
    <>
      <section className="hero-alert">
        <div className="alert-icon">
          <AlertTriangle size={23} />
        </div>
        <div>
          <div className="eyebrow">IMMEDIATE ACTION / TRIAGE LEVEL 1</div>
          <h2>
            {critical.length} clinical or validation exceptions need review
          </h2>
          <p>
            {critical[0]?.detail ??
              "No critical exceptions were detected in this dataset."}
          </p>
        </div>
        <button
          onClick={() =>
            document
              .getElementById("action-queue")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Review queue <ArrowDown size={16} />
        </button>
      </section>
      <section className="metrics" aria-label="Five primary operational KPIs">
        <Metric
          label={KPI[0][0]}
          value={`${data.kpis.completion}%`}
          count={`${data.received} / ${active.length} active slots`}
          definition={KPI[0][1]}
        />
        <Metric
          label={KPI[1][0]}
          value={`${data.kpis.onTime}%`}
          count={`${onTimeCount} / ${active.length} active slots`}
          definition={KPI[1][1]}
          tone="blue"
        />
        <Metric
          label={KPI[2][0]}
          value={`${data.kpis.completeVitals}%`}
          count={`${data.reports.filter((r) => r.slotId && data.slots.find((s) => s.id === r.slotId)?.reportId === r.id && r.complete).length} / ${data.received} received`}
          definition={KPI[2][1]}
        />
        <Metric
          label={KPI[3][0]}
          value={data.validAbnormal ? `${data.kpis.escalation}%` : "—"}
          count={`${data.validAbnormal} valid abnormal reports`}
          definition={KPI[3][1]}
          tone="red"
        />
        <Metric
          label={KPI[4][0]}
          value={`${data.kpis.quality}%`}
          count={`${data.reports.filter((r) => r.slotId && data.slots.find((s) => s.id === r.slotId)?.reportId === r.id && r.flags.length).length} / ${data.received} received`}
          definition={KPI[4][1]}
          tone="amber"
        />
      </section>
      <div className="overview-grid">
        <section className="panel action-panel" id="action-queue">
          <div className="panel-title">
            <div>
              <div className="eyebrow">SUPERVISOR ACTION LIST</div>
              <h2>Priority queue</h2>
              <p>Exceptions ranked by clinical and operational urgency</p>
            </div>
            <Badge tone="red">
              {data.actions.filter((a) => a.severity !== "positive").length} TO
              REVIEW
            </Badge>
          </div>
          <div className="action-list">
            {data.actions
              .filter((a) => a.severity !== "positive")
              .slice(0, 8)
              .map((a, i) => (
                <button
                  className="action-item"
                  key={`${a.title}-${i}`}
                  onClick={() =>
                    a.reportId
                      ? onEvidence({ reportId: a.reportId })
                      : a.slotId
                        ? onEvidence({ slotId: a.slotId })
                        : a.messageId
                          ? onEvidence({ messageId: a.messageId })
                          : undefined
                  }
                >
                  <span className={`priority-line ${a.severity}`} />
                  <span className="action-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="action-copy">
                    <strong>{a.title}</strong>
                    <small>{a.detail}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
          </div>
        </section>
        <section className="panel matrix-panel">
          <div className="panel-title">
            <div>
              <div className="eyebrow">CLIENT TELEMETRY MATRIX</div>
              <h2>Coverage by client</h2>
              <p>Expected, received and on-time over the audit window</p>
            </div>
            <Activity size={20} />
          </div>
          <div className="client-list">
            {data.clients.map((c) => (
              <div className="client-row" key={c.name}>
                <div className="client-id">{c.name}</div>
                <div className="client-progress">
                  <div className="client-progress-label">
                    <strong>{pct(c.received, c.expected)} received</strong>
                    <span>
                      {c.received} / {c.expected}
                    </span>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{ width: `${(c.received / c.expected) * 100}%` }}
                    />
                  </div>
                  <small>
                    {c.missing} missing · {c.late} late · {c.quality} quality
                    flags
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label={`See ${c.name} reports`}
                  onClick={() => onView("reports")}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            ))}
          </div>
          <button className="panel-link" onClick={() => onView("performance")}>
            Open client and caregiver performance <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <ShiftPulse data={data} onEvidence={onEvidence} />
      <section className="panel summary-band">
        <div>
          <div className="eyebrow">OPERATIONS READOUT</div>
          <h2>What management should act on this week</h2>
        </div>
        <p>
          <strong>{data.missing} missing reports</strong> are concentrated in{" "}
          {data.clients
            .filter((c) => c.missing)
            .map((c) => `${c.name} (${c.missing})`)
            .join(" and ")}
          . The shift pulse shows the recurring time slots.{" "}
          <strong>{data.late} late reports</strong> need timeliness review.
          Every exception opens its source message or expected-slot rule.
        </p>
      </section>
    </>
  );
}

function ShiftPulse({
  data,
  onEvidence,
}: {
  data: Analysis;
  onEvidence: (e: Evidence) => void;
}) {
  const dates = [...new Set(data.slots.map((s) => localDate(s.due)))].filter(
    (d) => d >= "2026-09-07" && d <= "2026-09-20",
  );
  const [focus, setFocus] = useState<{ client: string; date: string } | null>(
    null,
  );
  const focused = focus
    ? data.slots
        .filter(
          (s) => s.client === focus.client && localDate(s.due) === focus.date,
        )
        .sort((a, b) => a.due - b.due)
    : [];
  const state = (s: ExpectedSlot) => {
    const r = data.reports.find((r) => r.id === s.reportId);
    return s.paused
      ? "paused"
      : !r
        ? "missing"
        : r.dataIntegrityCritical || r.abnormal.length
          ? "alert"
          : r.flags.length
            ? "quality"
            : r.onTime
              ? "ontime"
              : (r.minutesFromDue ?? 0) < -RULES.onTimeMinutes
                ? "early"
                : "late";
  };
  return (
    <section className="panel pulse-panel">
      <div className="panel-title">
        <div>
          <div className="eyebrow">SHIFT PULSE / 14-DAY WINDOW</div>
          <h2>Reporting heartbeat</h2>
          <p>
            Each segment is one scheduled report. Select a day to inspect
            individual slots.
          </p>
        </div>
        <Clock3 size={20} />
      </div>
      <div className="pulse-scroll">
        <div className="pulse-grid">
          <div className="pulse-label" />
          <div className="pulse-days">
            {dates.map((d) => (
              <span key={d}>{d.slice(-2)}</span>
            ))}
          </div>
          {data.clients.map((c) => (
            <div className="pulse-row" key={c.name}>
              <strong>{c.name}</strong>
              <div className="pulse-days">
                {dates.map((d) => {
                  const slots = data.slots
                    .filter(
                      (s) => s.client === c.name && localDate(s.due) === d,
                    )
                    .sort((a, b) => a.due - b.due);
                  return (
                    <button
                      title={`${c.name} · ${d}`}
                      className={`pulse-cell ${focus?.client === c.name && focus.date === d ? "selected" : ""}`}
                      key={d}
                      onClick={() => setFocus({ client: c.name, date: d })}
                    >
                      {slots.map((s) => (
                        <i
                          title={`${s.time} ${state(s)}`}
                          className={state(s)}
                          key={s.id}
                        />
                      ))}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="pulse-legend">
        {[
          ["ontime", "On time"],
          ["late", "Late"],
          ["early", "Too early"],
          ["missing", "Missing"],
          ["alert", "Abnormal / validate"],
          ["quality", "Quality issue"],
          ["paused", "Care paused"],
        ].map(([tone, label]) => (
          <span key={tone}>
            <i className={tone} />
            {label}
          </span>
        ))}
      </div>
      {focus && (
        <div className="pulse-detail">
          <strong>
            {focus.client} · {focus.date}
          </strong>
          <div>
            {focused.map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  onEvidence(
                    s.reportId ? { reportId: s.reportId } : { slotId: s.id },
                  )
                }
              >
                <i className={state(s)} />
                {s.time} ·{" "}
                {s.paused ? "Paused" : s.reportId ? state(s) : "Missing"}
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Escalations({
  data,
  onEvidence,
}: {
  data: Analysis;
  onEvidence: (e: Evidence) => void;
}) {
  const cases = data.reports
    .filter((r) => r.abnormal.length && r.slotId && !r.duplicateOf)
    .sort((a, b) => a.sentAt - b.sentAt);
  return (
    <>
      <div className="view-intro">
        <div className="eyebrow">CLOSED-LOOP CLINICAL REVIEW</div>
        <h2>Escalation timeline</h2>
        <p>
          Report time starts the 15-minute response clock. Caregiver tagging and
          supervisor response are shown separately.
        </p>
      </div>
      <div className="escalation-grid">
        {cases.map((r) => (
          <article className="panel escalation-card" key={r.id}>
            <div className="escalation-head">
              <div>
                <Badge
                  tone={
                    r.escalation === "ESCALATED_WITHIN_SLA" ? "teal" : "red"
                  }
                >
                  {r.escalation.replaceAll("_", " ")}
                </Badge>
                <h3>
                  {r.client} · {r.abnormal.join(" / ")}
                </h3>
                <p>
                  {displayTime(r.sentAt)} · {r.sender}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={`Inspect ${r.id}`}
                onClick={() => onEvidence({ reportId: r.id })}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="timeline">
              <div>
                <span className="timeline-node teal" />
                <strong>Report received</strong>
                <small>{displayTime(r.sentAt)}</small>
              </div>
              <div>
                <span
                  className={`timeline-node ${r.tagged ? "teal" : "red"}`}
                />
                <strong>Caregiver tag</strong>
                <small>
                  {r.tagged
                    ? "Supervisor tagged in report"
                    : "No supervisor tag detected"}
                </small>
              </div>
              <div>
                <span
                  className={`timeline-node ${r.supervisorMinutes !== undefined && r.supervisorMinutes <= 15 ? "teal" : "red"}`}
                />
                <strong>Supervisor response</strong>
                <small>
                  {r.supervisorMinutes === undefined
                    ? "No matching response"
                    : `${r.supervisorMinutes} minutes after report`}
                </small>
              </div>
              <div>
                <span
                  className={`timeline-node ${r.followupMessageId ? "teal" : "neutral"}`}
                />
                <strong>Follow-up</strong>
                <small>
                  {r.followupMessageId
                    ? "Related recheck found"
                    : "No linked recheck"}
                </small>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!cases.length && (
        <div className="empty-state">
          No valid abnormal scheduled reports were detected.
        </div>
      )}
    </>
  );
}

function Quality({
  data,
  onEvidence,
}: {
  data: Analysis;
  onEvidence: (e: Evidence) => void;
}) {
  const rows = data.reports.filter((r) => r.flags.length);
  const counts = Object.entries(
    Object.groupBy(
      rows.flatMap((r) => r.flags),
      (f) => f,
    ),
  )
    .map(([flag, items]) => [flag, items?.length ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="view-intro">
        <div className="eyebrow">DATA TRUST / SOURCE PRESERVED</div>
        <h2>Measurement and parsing exceptions</h2>
        <p>
          Flags are review prompts. Original values remain unchanged, including
          implausible BP and Fahrenheit entries.
        </p>
      </div>
      <div className="quality-summary">
        {counts.map(([flag, count]) => (
          <div className="quality-count" key={flag}>
            <strong>{count}</strong>
            <span>{flag.replaceAll("_", " ")}</span>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Flagged report evidence</h2>
            <p>{rows.length} report messages with one or more flags</p>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="quality-list">
          {rows.slice(0, 80).map((r) => (
            <button key={r.id} onClick={() => onEvidence({ reportId: r.id })}>
              <span>
                <strong>
                  {r.client} · {displayTime(r.sentAt)}
                </strong>
                <small>
                  {r.sender} ·{" "}
                  {r.flags.map((f) => f.replaceAll("_", " ")).join(", ")}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
        {rows.length > 80 && (
          <p className="muted">
            Showing first 80 flagged reports. Use the Vitals Log filters for all
            records.
          </p>
        )}
      </section>
      {data.warnings.length > 0 && (
        <section className="panel">
          <h2>Unparsed line warnings</h2>
          {data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </section>
      )}
    </>
  );
}

function Performance({
  data,
  sort,
  onSort,
}: {
  data: Analysis;
  sort: keyof Aggregate;
  onSort: (s: keyof Aggregate) => void;
}) {
  const [kind, setKind] = useState<"clients" | "caregivers">("caregivers");
  const rows = [...(kind === "clients" ? data.clients : data.caregivers)].sort(
    (a, b) =>
      typeof a[sort] === "number"
        ? Number(b[sort]) - Number(a[sort])
        : a.name.localeCompare(b.name),
  );
  const columns: { key: keyof Aggregate; label: string }[] = [
    { key: "name", label: kind === "clients" ? "Client" : "Caregiver" },
    { key: "expected", label: "Expected" },
    { key: "received", label: "Received" },
    { key: "onTime", label: "On time" },
    { key: "complete", label: "Complete" },
    { key: "missing", label: "Missing" },
    { key: "late", label: "Late" },
    { key: "escalationIssues", label: "Escalation issues" },
    { key: "quality", label: "Quality flags" },
  ];
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <div className="eyebrow">ROSTER / CLIENT COVERAGE</div>
          <h2>Reporting performance</h2>
          <p>
            Expected workload comes from the inferred roster and confirmed
            coverage events.
          </p>
        </div>
        <ClipboardList size={20} />
      </div>
      <div className="segmented">
        <button
          className={kind === "caregivers" ? "active" : ""}
          onClick={() => setKind("caregivers")}
        >
          Caregivers
        </button>
        <button
          className={kind === "clients" ? "active" : ""}
          onClick={() => setKind("clients")}
        >
          Clients
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>
                  <button onClick={() => onSort(c.key)}>
                    {c.label} {sort === c.key ? "↓" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                {columns.map((c) => (
                  <td key={c.key}>{r[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel-note">
        Assignment source: dominant sample pattern, plus explicit Faith W.
        coverage on 18–19 September. Confirm against Care360’s roster before
        production use.
      </p>
    </section>
  );
}

function RawBlock({ message }: { message: Analysis["messages"][number] }) {
  return (
    <div className="raw-block">
      <div>
        <strong>{message.sender}</strong>
        <span>
          {displayTime(message.at)} · line {message.line} · {message.id}
        </span>
      </div>
      <pre>{message.text}</pre>
    </div>
  );
}
function EvidenceReport({
  report: r,
  data,
}: {
  report: Report;
  data: Analysis;
}) {
  const raw = data.messages.find((m) => m.id === r.messageId)!;
  const response = data.messages.find((m) => m.id === r.supervisorMessageId);
  const followup = data.messages.find((m) => m.id === r.followupMessageId);
  return (
    <div className="evidence-body">
      <div className="evidence-status">
        <Badge
          tone={
            r.dataIntegrityCritical || r.abnormal.length
              ? "red"
              : r.flags.length
                ? "amber"
                : "teal"
          }
        >
          {r.dataIntegrityCritical
            ? "Critical validation"
            : r.abnormal.length
              ? "Clinical abnormal"
              : r.flags.length
                ? "Quality review"
                : "Routine report"}
        </Badge>
        <strong>
          {r.client} · {r.id}
        </strong>
      </div>
      <h3>Original WhatsApp report</h3>
      <RawBlock message={raw} />
      <h3>Parsed fields and schedule</h3>
      <dl className="evidence-grid">
        <div>
          <dt>Stated slot</dt>
          <dd>{r.statedTime ?? "—"}</dd>
        </div>
        <div>
          <dt>Expected due</dt>
          <dd>{r.due ? displayTime(r.due) : "Unmatched"}</dd>
        </div>
        <div>
          <dt>Sent at</dt>
          <dd>{displayTime(r.sentAt)}</dd>
        </div>
        <div>
          <dt>Timing</dt>
          <dd>
            {r.minutesFromDue === undefined
              ? "Unmatched"
              : `${r.minutesFromDue >= 0 ? "+" : ""}${r.minutesFromDue} min · ${r.onTime ? "on time" : (r.minutesFromDue ?? 0) < -RULES.onTimeMinutes ? "too early" : "late"}`}
          </dd>
        </div>
        <div>
          <dt>BP</dt>
          <dd>
            {r.vitals.systolic ?? "—"}/{r.vitals.diastolic ?? "—"}
          </dd>
        </div>
        <div>
          <dt>Pulse / Temp / SpO₂</dt>
          <dd>
            {r.vitals.pulse ?? "—"} / {r.vitals.temperature ?? "—"}
            {r.vitals.temperatureUnit === "F" ? "°F" : "°C"} /{" "}
            {r.vitals.spo2 ?? "—"}%
          </dd>
        </div>
        <div>
          <dt>Care note</dt>
          <dd>{r.narrative || "—"}</dd>
        </div>
        <div>
          <dt>Duplicate</dt>
          <dd>{r.duplicateOf ?? "No"}</dd>
        </div>
      </dl>
      <h3>Rule decisions</h3>
      {r.abnormal.length ? (
        r.abnormal.map((flag) => (
          <p className="rule-line" key={flag}>
            <AlertTriangle size={16} />
            {flag}: threshold in configured clinical rules.
          </p>
        ))
      ) : (
        <p className="muted">No valid abnormal threshold crossed.</p>
      )}
      {r.flagReasons.map((reason, i) => (
        <p className="rule-line" key={`${reason}-${i}`}>
          <Info size={16} />
          <strong>{r.flags[i]}</strong> — {reason}
        </p>
      ))}
      <p className="rule-line">
        <Clock3 size={16} /> Escalation: {r.escalation.replaceAll("_", " ")}.{" "}
        {r.tagged
          ? "Caregiver tagged supervisor."
          : "No caregiver supervisor tag detected."}{" "}
        {r.supervisorMinutes !== undefined &&
          `Matched response after ${r.supervisorMinutes} minutes.`}
      </p>
      {response && (
        <>
          <h3>Matched supervisor response</h3>
          <RawBlock message={response} />
        </>
      )}
      {followup && (
        <>
          <h3>Follow-up / recheck</h3>
          <RawBlock message={followup} />
        </>
      )}
    </div>
  );
}
function EvidenceSlot({ slot, data }: { slot: ExpectedSlot; data: Analysis }) {
  const pause = data.messages.find((m) => m.id === slot.pauseEvidence);
  return (
    <div className="evidence-body">
      <div className="evidence-status">
        <Badge tone={slot.paused ? "blue" : "red"}>
          {slot.paused ? "Care paused" : "Missing report"}
        </Badge>
        <strong>{slot.client}</strong>
      </div>
      <h3>Expected slot determination</h3>
      <dl className="evidence-grid">
        <div>
          <dt>Due</dt>
          <dd>{displayTime(slot.due)}</dd>
        </div>
        <div>
          <dt>Shift</dt>
          <dd>{slot.shift}</dd>
        </div>
        <div>
          <dt>Expected caregiver</dt>
          <dd>{slot.caregiver}</dd>
        </div>
        <div>
          <dt>Rule</dt>
          <dd>
            {slot.shift === "day"
              ? "07:00 / 11:00 / 15:00 each day"
              : "18:00 to 06:00 every 2 hours"}
          </dd>
        </div>
      </dl>
      <p className="rule-line">
        <Info size={16} />
        {slot.paused
          ? "Excluded because the latest care episode event before due time is a confirmed pause."
          : "No parsed report claimed this active client and stated slot. This scheduled slot counts as missing."}
      </p>
      {pause && (
        <>
          <h3>Pause evidence</h3>
          <RawBlock message={pause} />
        </>
      )}
    </div>
  );
}
