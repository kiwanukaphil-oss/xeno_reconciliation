import { useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { fetchClientInsightsSummary, type InsightSegment } from "../../services/api";
import { BreakdownBarList, type Breakdown, type InsightMetric } from "./BreakdownBarList";
import { formatCount, formatDate, formatPct, formatUGXCompact } from "./insightFormat";

interface InsightsSummary {
  segment: InsightSegment;
  asOf: { prices: string; transactions: string };
  kpis: {
    fundedAccounts: number;
    aum: number;
    medianBalance: number;
    depositorsLast12Months: number;
    genderKnownShareOfAccounts: number;
    genderKnownShareOfAum: number;
  };
  breakdowns: Breakdown[];
}

const SEGMENT_OPTIONS: Array<{ value: InsightSegment; label: string }> = [
  { value: "INDIVIDUAL", label: "Individuals" },
  { value: "INSTITUTIONAL", label: "Institutions" },
  { value: "ALL", label: "All accounts" },
];

const METRIC_OPTIONS: Array<{ value: InsightMetric; label: string }> = [
  { value: "aum", label: "Share of AUM" },
  { value: "accounts", label: "Share of accounts" },
];

// Demographic cards only describe people, so institutions skip them
const DEMOGRAPHIC_DIMENSIONS = new Set(["gender", "ageBand"]);

/** Segmented button group used for the segment and measure toggles. */
const ToggleGroup = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
    {options.map((option) => (
      <button
        key={option.value}
        onClick={() => onChange(option.value)}
        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
          value === option.value
            ? "bg-blue-50 text-blue-700 font-medium"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const StatTile = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <div className="bg-white p-5 rounded-lg shadow">
    <p className="text-sm text-gray-600">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    <p className="text-xs text-gray-500 mt-1">{hint}</p>
  </div>
);

/**
 * AUM composition of funded accounts by client profile (gender, age, location,
 * channel, network, balance and saving frequency). Unknown is always shown so
 * partial demographic coverage is visible, and AUM vs account share can be toggled.
 */
const ClientInsights = () => {
  const [segment, setSegment] = useState<InsightSegment>("INDIVIDUAL");
  const [metric, setMetric] = useState<InsightMetric>("aum");
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSummary(segment);
  }, [segment]);

  const loadSummary = async (selected: InsightSegment) => {
    try {
      setLoading(true);
      setError(null);
      setSummary(await fetchClientInsightsSummary(selected));
    } catch (err: any) {
      console.error("Failed to load client insights:", err);
      setError(err.message || "Failed to load client insights");
    } finally {
      setLoading(false);
    }
  };

  const visibleBreakdowns =
    summary?.breakdowns.filter(
      (b) => segment !== "INSTITUTIONAL" || !DEMOGRAPHIC_DIMENSIONS.has(b.dimension)
    ) ?? [];

  return (
    <div className="p-6">
      {/* Filters: one row above the charts */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup options={SEGMENT_OPTIONS} value={segment} onChange={setSegment} />
          <ToggleGroup options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
        </div>
        {summary && (
          <p className="text-sm text-gray-600">
            Funded accounts (UGX 5,000+) · transactions to {formatDate(summary.asOf.transactions)} ·
            prices of {formatDate(summary.asOf.prices)}
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={() => loadSummary(segment)}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {summary && !loading && !error && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <StatTile label="Funded accounts" value={formatCount(summary.kpis.fundedAccounts)} hint="Balance of UGX 5,000 or more" />
            <StatTile label="AUM" value={formatUGXCompact(summary.kpis.aum)} hint="At latest mid prices" />
            <StatTile label="Median balance" value={formatUGXCompact(summary.kpis.medianBalance)} hint="Half of accounts hold less" />
            <StatTile
              label="Deposited in last 12 months"
              value={formatCount(summary.kpis.depositorsLast12Months)}
              hint={`${formatPct(summary.kpis.depositorsLast12Months / Math.max(summary.kpis.fundedAccounts, 1))} of funded accounts`}
            />
            <StatTile
              label="Gender known"
              value={formatPct(summary.kpis.genderKnownShareOfAum, 0) + " of AUM"}
              hint={`${formatPct(summary.kpis.genderKnownShareOfAccounts, 0)} of accounts`}
            />
          </div>

          {segment !== "INSTITUTIONAL" && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 mb-6 text-sm text-blue-900">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                Demographics come from Ultima sign-up data and are mostly missing for clients who signed up via MTN.
                They cover most of the AUM but a minority of accounts, so compare groups on share of AUM, and read
                share of accounts with the Unknown bar in view. Counts are accounts, not people.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {visibleBreakdowns.map((breakdown) => (
              <BreakdownBarList key={breakdown.dimension} breakdown={breakdown} metric={metric} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ClientInsights;
