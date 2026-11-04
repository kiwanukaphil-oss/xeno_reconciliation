import { useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { fetchClientInsightsSummary, type GenderBasis, type InsightSegment } from "../../services/api";
import { BreakdownBarList, type Breakdown, type InsightMetric } from "./BreakdownBarList";
import { formatCount, formatDate, formatPct, formatUGXCompact, SEGMENT_OPTIONS } from "./insightFormat";
import { StatTile, ToggleGroup } from "./InsightControls";
import { useInsightAsOf } from "./InsightAsOf";

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
    genderDeclaredShareOfAccounts: number;
    genderEstimatedShareOfAccounts: number;
  };
  weightedGender: {
    femaleShareOfAccounts: number | null;
    femaleShareOfAum: number | null;
  };
  genderEstimate: { holdoutAccuracy: number; mtnHoldoutAccuracy: number | null } | null;
  breakdowns: Breakdown[];
}

const METRIC_OPTIONS: Array<{ value: InsightMetric; label: string }> = [
  { value: "aum", label: "Share of AUM" },
  { value: "accounts", label: "Share of accounts" },
];

const GENDER_BASIS_OPTIONS: Array<{ value: GenderBasis; label: string }> = [
  { value: "ESTIMATED", label: "Gender: declared + estimated" },
  { value: "DECLARED", label: "Declared only" },
];

// Demographic cards only describe people, so institutions skip them
const DEMOGRAPHIC_DIMENSIONS = new Set(["gender", "ageBand"]);

/**
 * AUM composition of funded accounts by client profile (gender, age, location,
 * channel, network, balance and saving frequency). Unknown is always shown so
 * partial demographic coverage is visible, and AUM vs account share can be toggled.
 */
const ClientInsights = () => {
  const [segment, setSegment] = useState<InsightSegment>("INDIVIDUAL");
  const [metric, setMetric] = useState<InsightMetric>("aum");
  const [genderBasis, setGenderBasis] = useState<GenderBasis>("ESTIMATED");
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { asOf } = useInsightAsOf();

  useEffect(() => {
    let active = true;
    loadSummary(segment, genderBasis, () => active);
    // A slower, older request (e.g. a date still being prepared) must not overwrite newer figures
    return () => {
      active = false;
    };
  }, [segment, genderBasis, asOf]);

  const loadSummary = async (selected: InsightSegment, basis: GenderBasis, isActive: () => boolean = () => true) => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchClientInsightsSummary(selected, basis, asOf);
      if (isActive()) setSummary(result);
    } catch (err: any) {
      console.error("Failed to load client insights:", err);
      if (isActive()) setError(err.message || "Failed to load client insights");
    } finally {
      if (isActive()) setLoading(false);
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
          {segment !== "INSTITUTIONAL" && (
            <ToggleGroup options={GENDER_BASIS_OPTIONS} value={genderBasis} onChange={setGenderBasis} />
          )}
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
            onClick={() => loadSummary(segment, genderBasis)}
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
                value={formatPct(summary.kpis.genderKnownShareOfAum, 0) + " of AUM"}
                hint={`${formatPct(summary.kpis.genderKnownShareOfAccounts, 0)} of accounts`}
              />
            ) : (
              <StatTile
                label="Women (estimated)"
                value={formatPct(summary.weightedGender.femaleShareOfAccounts, 0) + " of accounts"}
                hint={`${formatPct(summary.weightedGender.femaleShareOfAum, 0)} of AUM · probability-weighted`}
              />
            )}
          </div>

          {segment !== "INSTITUTIONAL" && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 mb-6 text-sm text-blue-900">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                Gender is declared in Ultima for {formatPct(summary.kpis.genderDeclaredShareOfAccounts, 0)} of accounts
                and estimated from the client's name for a further {formatPct(summary.kpis.genderEstimatedShareOfAccounts, 0)}
                {summary.genderEstimate &&
                  ` (${formatPct(summary.genderEstimate.holdoutAccuracy, 0)} accurate when tested on declared accounts)`}
                . The Gender chart labels an estimate only when it is at least 90% confident; the "Women" tile weights every
                estimate by its probability. Age and location come from Ultima only and are mostly missing for MTN
                sign-ups, so read share of accounts with the Unknown bar in view. Counts are accounts, not people.
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
