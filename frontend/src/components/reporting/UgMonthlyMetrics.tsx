import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Info, Loader2, Pencil, Save, X } from "lucide-react";
import {
  downloadUgMetricsWorkbook,
  fetchInsightAsOfDates,
  fetchUgMetricsReport,
  saveUgManualInputs,
  type UgMetricsRow,
  type UgRowFormat,
} from "../../services/api";
import { formatCount, formatDate, formatPct, saveBlob } from "../client-insights/insightFormat";

// Months shown when the page opens: the latest complete month and the two before it
const DEFAULT_MONTHS_SHOWN = 3;

/** "2026-09" shifted by n months. */
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** The last month whose month-end is covered by the loaded transactions. */
const latestCompleteMonth = (latestTransactionDate: string) => {
  const month = latestTransactionDate.slice(0, 7);
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return latestTransactionDate >= monthEnd ? month : shiftMonth(month, -1);
};

const formatMonthHeader = (periodEnd: string) =>
  new Date(`${periodEnd}T00:00:00`).toLocaleDateString("en-UG", { month: "short", year: "2-digit" });

const formatCell = (value: number | null, format: UgRowFormat | null) => {
  if (value === null) return "–";
  if (format === "pct") return formatPct(value);
  if (format === "rate") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return formatCount(value);
};

/** Typed text -> number, or null for blank (clears the figure); undefined when it is not a number. */
const parseDraft = (text: string): number | null | undefined => {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
};

// Unsaved edits, keyed "YYYY-MM|metricKey"
type Drafts = Record<string, string>;
const draftKey = (month: string, key: string) => `${month}|${key}`;

/**
 * Monthly Metrics (UG): the Inputs-UG sheet of the monthly XENO_Metrics report, computed from the
 * system for a range of months, row-for-row like the workbook. Formula rows are evaluated from the
 * rows they reference. Manual rows (USD/UGX, financials, bank balances, visitors, autosaves) are typed
 * in on the page in edit mode and saved per month; they then feed the formulas and the Excel download.
 */
const UgMonthlyMetrics = () => {
  const queryClient = useQueryClient();
  const { data: dates } = useQuery({ queryKey: ["insight-as-of-dates"], queryFn: fetchInsightAsOfDates, staleTime: 60_000 });
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [showManual, setShowManual] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const maxMonth = dates ? latestCompleteMonth(dates.latest.transactions) : undefined;

  // Open on the latest complete month and the two before it, once the data range is known
  useEffect(() => {
    if (maxMonth && !range) setRange({ from: shiftMonth(maxMonth, 1 - DEFAULT_MONTHS_SHOWN), to: maxMonth });
  }, [maxMonth, range]);

  const { data: report, error, isFetching } = useQuery({
    queryKey: ["ug-metrics", range?.from, range?.to],
    queryFn: ({ signal }) => fetchUgMetricsReport(range!.from, range!.to, setPreparing, signal),
    enabled: !!range && range.from <= range.to,
    staleTime: 5 * 60 * 1000,
  });

  const visibleRows = useMemo(() => {
    if (!report) return [];
    if (showManual || editing) return report.rows;
    // Drop manual rows and any section header left with nothing under it
    const kept = report.rows.filter((r) => r.kind !== "manual");
    return kept.filter((r, i) => r.kind !== "header" || (kept[i + 1] && kept[i + 1].kind !== "header"));
  }, [report, showManual, editing]);

  const changedCount = Object.keys(drafts).length;

  const download = async () => {
    if (!range) return;
    try {
      setDownloading(true);
      setDownloadError(null);
      const blob = await downloadUgMetricsWorkbook(range.from, range.to);
      const name = range.from === range.to ? range.from : `${range.from}-to-${range.to}`;
      saveBlob(blob, `xeno-metrics-inputs-ug-${name}.xlsx`);
    } catch (err: any) {
      setDownloadError(err.message || "Failed to download");
    } finally {
      setDownloading(false);
    }
  };

  const updateRange = (key: "from" | "to", value: string) => {
    if (value && range) setRange({ ...range, [key]: value });
  };

  const stopEditing = () => {
    setEditing(false);
    setDrafts({});
    setSaveError(null);
  };

  /**
   * Validates every edited cell, then saves each month's changes (one request per month). Nothing is
   * sent if any cell is not a number. The report is reloaded afterwards so formulas reflect the figures.
   */
  const saveDrafts = async () => {
    if (!report) return;
    const labelByKey = new Map(report.rows.filter((r) => r.key).map((r) => [r.key!, `${r.label} (row ${r.row})`]));
    const byMonth = new Map<string, Record<string, number | null>>();
    for (const [compositeKey, text] of Object.entries(drafts)) {
      const [month, key] = compositeKey.split("|");
      const value = parseDraft(text);
      if (value === undefined) {
        setSaveError(`${labelByKey.get(key) ?? key} for ${month} is not a number`);
        return;
      }
      byMonth.set(month, { ...(byMonth.get(month) ?? {}), [key]: value });
    }
    try {
      setSaving(true);
      setSaveError(null);
      for (const [month, values] of byMonth) await saveUgManualInputs(month, values);
      await queryClient.invalidateQueries({ queryKey: ["ug-metrics"] });
      stopEditing();
    } catch (err: any) {
      setSaveError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-gray-700">
            From
            <input
              type="month"
              value={range?.from ?? ""}
              max={range?.to}
              disabled={editing}
              onChange={(e) => updateRange("from", e.target.value)}
              className="block mt-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 disabled:bg-gray-100"
            />
          </label>
          <label className="text-sm text-gray-700">
            To
            <input
              type="month"
              value={range?.to ?? ""}
              min={range?.from}
              max={maxMonth}
              disabled={editing}
              onChange={(e) => updateRange("to", e.target.value)}
              className="block mt-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 disabled:bg-gray-100"
            />
          </label>
          {!editing && (
            <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
              <input type="checkbox" checked={showManual} onChange={(e) => setShowManual(e.target.checked)} />
              Show manual-input rows
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={stopEditing}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={saveDrafts}
                disabled={saving || changedCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save {changedCount > 0 ? `${changedCount} change${changedCount === 1 ? "" : "s"}` : ""}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                disabled={!report || isFetching}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <Pencil className="w-4 h-4" />
                Enter manual figures
              </button>
              <button
                onClick={download}
                disabled={!report || downloading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download Inputs-UG (Excel)
              </button>
            </>
          )}
        </div>
      </div>
      {downloadError && <p className="text-sm text-red-700">{downloadError}</p>}
      {saveError && <p className="text-sm text-red-700">{saveError}</p>}

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-900">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        {editing ? (
          <p>
            Type figures into the shaded rows for any month shown (blank clears a figure). Outflows and losses can be negative;
            USD/UGX, visitors and autosave counts cannot. Saved figures feed the formula rows and the Excel download.
          </p>
        ) : (
          <p>
            Rows match the Inputs-UG sheet, so a month's column can be pasted straight into the workbook. Shaded rows have no
            source in the system: use "Enter manual figures" to fill them in once a month. The download keeps the derived
            rows as live formulas. Definitions are at the bottom of the page.
          </p>
        )}
      </div>

      {(isFetching || !report) && !error && (
        <div className="flex items-center justify-center gap-2 h-48 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          {preparing ? "Preparing month-end figures (about a minute per month the first time)" : "Loading"}
        </div>
      )}
      {error && <p className="text-red-700">{(error as Error).message}</p>}

      {report && !isFetching && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="text-left py-2 px-3 font-medium w-12">Row</th>
                  <th className="text-left py-2 px-3 font-medium">Metric</th>
                  {report.months.map((m) => (
                    <th
                      key={m.month}
                      className="text-right py-2 px-3 font-medium whitespace-nowrap"
                      title={m.manualUpdatedAt ? `Manual figures last saved ${formatDate(m.manualUpdatedAt)}` : "No manual figures saved"}
                    >
                      {formatMonthHeader(m.periodEnd)}
                    </th>
                  ))}
                  <th className="text-left py-2 px-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <MetricRow
                    key={row.row}
                    row={row}
                    months={report.months.map((m) => m.month)}
                    editing={editing}
                    drafts={drafts}
                    onDraftChange={(month, key, text) => setDrafts((d) => ({ ...d, [draftKey(month, key)]: text }))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <section className="bg-white border border-gray-200 rounded-lg p-4 text-sm space-y-3">
            <h3 className="font-semibold text-gray-900">Definitions</h3>
            <ul className="list-disc pl-5 space-y-1 text-gray-700">
              {report.definitions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <h3 className="font-semibold text-gray-900 pt-2">Not computed by the system (entered by hand)</h3>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-gray-700">
              {report.notComputed.map((n) => (
                <Fragment key={n.metric}>
                  <dt className="font-medium">{n.metric}</dt>
                  <dd>{n.reason}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
};

const SOURCE_LABELS = { system: "System", formula: "Formula" } as const;

interface MetricRowProps {
  row: UgMetricsRow;
  months: string[];
  editing: boolean;
  drafts: Drafts;
  onDraftChange: (month: string, key: string, text: string) => void;
}

/**
 * One Inputs-UG row: a section title, or the metric with one value per month and where it comes from.
 * In edit mode a manual row shows an input per month, holding the unsaved text or the saved figure.
 */
const MetricRow = ({ row, months, editing, drafts, onDraftChange }: MetricRowProps) => {
  if (row.kind === "header") {
    return (
      <tr className="bg-gray-50 border-b border-gray-100">
        <td className="py-1.5 px-3 text-xs text-gray-400">{row.row}</td>
        <td colSpan={months.length + 2} className="py-1.5 px-3 font-semibold text-gray-900">
          {row.label}
        </td>
      </tr>
    );
  }
  const isManual = row.kind === "manual";
  const canEdit = editing && isManual && !!row.key;
  return (
    <tr className={`border-b border-gray-100 ${isManual ? "bg-amber-50/60" : ""}`}>
      <td className="py-1.5 px-3 text-xs text-gray-400">{row.row}</td>
      <td className="py-1.5 px-3 text-gray-900 whitespace-nowrap">
        {row.band && <span className="text-gray-500 mr-2">{row.band}</span>}
        {row.label}
      </td>
      {row.values.map((value, i) => {
        const month = months[i];
        if (canEdit) {
          const draft = drafts[draftKey(month, row.key!)];
          const changed = draft !== undefined;
          return (
            <td key={month} className="py-1 px-2 text-right">
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${row.label}, ${month}`}
                value={changed ? draft : value === null ? "" : String(value)}
                onChange={(e) => onDraftChange(month, row.key!, e.target.value)}
                className={`w-36 text-right text-sm border rounded px-2 py-0.5 ${
                  changed ? "border-green-500 bg-green-50" : "border-gray-300 bg-white"
                }`}
              />
            </td>
          );
        }
        return (
          <td key={month} className={`py-1.5 px-3 text-right whitespace-nowrap ${isManual && value === null ? "text-gray-400" : "text-gray-900"}`}>
            {isManual && value === null ? "" : formatCell(value, row.format)}
          </td>
        );
      })}
      <td className={`py-1.5 px-3 text-xs whitespace-nowrap ${isManual ? "text-amber-800" : "text-gray-500"}`}>
        {row.kind === "manual" ? `Manual: ${row.source}` : SOURCE_LABELS[row.kind]}
      </td>
    </tr>
  );
};

export default UgMonthlyMetrics;
