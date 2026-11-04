import { useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { fetchClientInsightsSummary, type GenderView, type InsightSegment } from "../../services/api";
import { BreakdownBarList, type Breakdown, type InsightMetric } from "./BreakdownBarList";
import { formatCount, formatDate, formatPct, formatUGXCompact, SEGMENT_OPTIONS } from "./insightFormat";
import { StatTile, ToggleGroup } from "./InsightControls";
import { GenderControls, GenderLegend, type GenderSplit, type GenderSplitMode } from "./GenderSplit";
import { useInsightAsOf } from "./InsightAsOf";

interface InsightsSummary {
  segment: InsightSegment;
  genderView: GenderView;
  asOf: { prices: string; transactions: string };
  kpis: {
    fundedAccounts: number;
    aum: number;
    medianBalance: number;
    depositorsLast12Months: number;
    genderIdentifiedAccounts: number;
    genderIdentifiedShareOfAccounts: number;
    genderIdentifiedShareOfAum: number;
  };
  gender: GenderSplit;
  genderNote: string;
  breakdowns: Breakdown[];
}

const METRIC_OPTIONS: Array<{ value: InsightMetric; label: string }> = [
  { value: "aum", label: "Share of AUM" },
  { value: "accounts", label: "Share of accounts" },
];

// Demographic cards only describe people, so institutions skip them
const DEMOGRAPHIC_DIMENSIONS = new Set(["gender", "ageBand"]);

/**
 * AUM composition of funded accounts by client profile (gender, age, location,
 * channel, network, balance and saving frequency). Unknown is always shown so
 * partial demographic coverage is visible, and AUM vs account share can be toggled.
 * Gender is declared gender only: either identified clients alone, or every client
 * with the unidentified allocated in the known ratio; any card can also show the
 * female/male split of each of its rows.
 */
const ClientInsights = () => {
  const [segment, setSegment] = useState<InsightSegment>("INDIVIDUAL");
  const [metric, setMetric] = useState<InsightMetric>("aum");
  const [genderView, setGenderView] = useState<GenderView>("IDENTIFIED");
  const [genderSplit, setGenderSplit] = useState<GenderSplitMode>("OFF");
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { asOf } = useInsightAsOf();

  useEffect(() => {
    let active = true;
    loadSummary(segment, genderView, () => active);
    // A slower, older request (e.g. a date still being prepared) must not overwrite newer figures
    return () => {
      active = false;
    };
  }, [segment, genderView, asOf]);

  const loadSummary = async (selected: InsightSegment, view: GenderView, isActive: () => boolean = () => true) => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchClientInsightsSummary(selected, view, asOf);
      if (isActive()) setSummary(result);
    } catch (err: any) {
      console.error("Failed to load client insights:", err);
      if (isActive()) setError(err.message || "Failed to load client insights");
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  const showGender = segment !== "INSTITUTIONAL";
  const splitView = showGender && genderSplit === "ON" ? genderView : undefined;
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
          {showGender && (
            <GenderControls view={genderView} onViewChange={setGenderView} split={genderSplit} onSplitChange={setGenderSplit} />
          )}
          {splitView && <GenderLegend />}
        </div>
        {summary && !loading && (
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
            onClick={() => loadSummary(segment, genderView)}
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
            {segment === "INSTITUTIONAL" ? (
              <StatTile
                label="Gender known"
                value={formatPct(summary.kpis.genderIdentifiedShareOfAum, 0) + " of AUM"}
                hint={`${formatPct(summary.kpis.genderIdentifiedShareOfAccounts, 0)} of accounts`}
              />
            ) : (
              <StatTile
                label="Women"
                value={formatPct(summary.gender.femaleShareOfCount, 0) + " of accounts"}
                hint={
                  genderView === "IDENTIFIED"
                    ? `${formatPct(summary.gender.femaleShareOfValue, 0)} of AUM · of ${formatCount(summary.kpis.genderIdentifiedAccounts)} identified`
                    : `≈ ${formatCount(summary.gender.femaleCount)} accounts · ${formatPct(summary.gender.femaleShareOfValue, 0)} of AUM (allocated)`
                }
              />
            )}
          </div>

          {showGender && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 mb-6 text-sm text-blue-900">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                Gender is declared in Ultima for {formatPct(summary.kpis.genderIdentifiedShareOfAccounts, 0)} of accounts (
                {formatPct(summary.kpis.genderIdentifiedShareOfAum, 0)} of AUM). {summary.genderNote} Age and location come from
                Ultima only and are mostly missing for MTN sign-ups, so read share of accounts with the Unknown bar in view. Counts
                are accounts, not people.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {visibleBreakdowns.map((breakdown) => (
              <BreakdownBarList key={breakdown.dimension} breakdown={breakdown} metric={metric} genderSplitView={splitView} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ClientInsights;
