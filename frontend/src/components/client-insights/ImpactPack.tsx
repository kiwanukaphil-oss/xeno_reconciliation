import { useEffect, useState } from "react";
import { Download, Info, Loader2 } from "lucide-react";
import { downloadImpactPack, fetchImpactPack } from "../../services/api";
import { formatCount, formatDate, formatGroupLabel, formatPct, formatUGX, saveBlob } from "./insightFormat";

type PackQuestion = "Q1" | "Q2" | "Q3";
type PackColumnFormat = "text" | "int" | "ugx" | "pct";

interface PackTable {
  id: string;
  question: PackQuestion;
  title: string;
  note?: string;
  columns: Array<{ key: string; header: string; format: PackColumnFormat }>;
  rows: Array<Record<string, string | number | null>>;
}

interface ImpactPackData {
  generatedAt: string;
  asOf: { transactions: string; prices: string; ultimaGoalSnapshot: string | null };
  questions: Record<PackQuestion, string>;
  readMe: string[];
  notCaptured: Array<{ item: string; note: string }>;
  tables: PackTable[];
}

const formatCell = (value: string | number | null | undefined, format: PackColumnFormat) => {
  if (value === null || value === undefined) return "–";
  if (typeof value === "string") return format === "text" ? formatGroupLabel(value) : value;
  if (format === "pct") return formatPct(value);
  if (format === "ugx") return formatUGX(value);
  return formatCount(value);
};

const PackTableView = ({ table }: { table: PackTable }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <h3 className="text-base font-semibold text-gray-900">{table.title}</h3>
    {table.note && <p className="text-sm text-gray-500 mt-1">{table.note}</p>}
    <div className="overflow-x-auto mt-4">
      {table.rows.length === 0 ? (
        <p className="text-sm text-gray-500">No data</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              {table.columns.map((c) => (
                <th key={c.key} className={`py-2 px-2 font-medium ${c.format === "text" ? "text-left" : "text-right"}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                {table.columns.map((c) => (
                  <td key={c.key} className={`py-2 px-2 ${c.format === "text" ? "text-left text-gray-900" : "text-right text-gray-900"}`}>
                    {formatCell(row[c.key], c.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

/**
 * Impact & Inclusion data pack: answers the investor questions on customer
 * profile, usage and outcomes, with definitions, caveats and what the system
 * does not capture. Downloadable as Excel for sharing.
 */
const ImpactPack = () => {
  const [pack, setPack] = useState<ImpactPackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPack();
  }, []);

  const loadPack = async () => {
    try {
      setLoading(true);
      setError(null);
      setPack(await fetchImpactPack());
    } catch (err: any) {
      console.error("Failed to load impact pack:", err);
      setError(err.message || "Failed to load impact pack");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const blob = await downloadImpactPack();
      saveBlob(blob, `xeno-impact-pack-${pack?.asOf.transactions ?? "latest"}.xlsx`);
    } catch (err: any) {
      setError(err.message || "Failed to download impact pack");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        <p className="text-sm text-gray-500">Building the data pack…</p>
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={loadPack} className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-gray-600">
          Transactions to {formatDate(pack.asOf.transactions)} · prices of {formatDate(pack.asOf.prices)} · Ultima goal
          statistics of {formatDate(pack.asOf.ultimaGoalSnapshot)}
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60"
        >
          {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          Download Excel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center">
            <Info className="w-4 h-4 mr-2 text-blue-600" />
            Definitions and caveats
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-700">
            {pack.readMe.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Not captured in the system</h2>
          <dl className="space-y-2 text-sm">
            {pack.notCaptured.map((n) => (
              <div key={n.item}>
                <dt className="font-medium text-gray-900">{n.item}</dt>
                <dd className="text-gray-600">{n.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {(["Q1", "Q2", "Q3"] as PackQuestion[]).map((question, index) => (
        <section key={question} className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 pt-2">
            {index + 1}. {pack.questions[question]}
          </h2>
          {pack.tables
            .filter((t) => t.question === question)
            .map((table) => (
              <PackTableView key={table.id} table={table} />
            ))}
        </section>
      ))}
    </div>
  );
};

export default ImpactPack;
