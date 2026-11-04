import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { fetchRiskAllocation, fetchSuitabilityReview, type GenderView, type InsightSegment } from "../../services/api";
import { BreakdownBarList, type Breakdown } from "./BreakdownBarList";
import { ErrorPanel, LoadingPanel, ShareBar, StatTile, ToggleGroup } from "./InsightControls";
import { GenderControls, GenderLegend, GenderSplitBar, type GenderSplit, type GenderSplitMode } from "./GenderSplit";
import { useInsightAsOf } from "./InsightAsOf";
import {
  formatCount,
  formatGroupLabel,
  formatPct,
  formatUGX,
  formatUGXCompact,
  FUND_CODES,
  SEGMENT_OPTIONS,
} from "./insightFormat";

type FundSplit = Record<(typeof FUND_CODES)[number], number | null>;

interface RiskAllocationReport {
  driftTolerancePp: number;
  totalValue: number;
  byRiskScore: Array<{
    riskScore: number | null;
    goals: number;
    value: number;
    shareOfValue: number;
    actualEquityPct: number | null;
    targetEquityPct: number | null;
    /** count = goals, value = goal value, by the holder's declared gender */
    gender: GenderSplit;
  }>;
  byGoalCategory: Breakdown;
  genderNote: string;
  driftBands: Array<{ band: string; goals: number; value: number; shareOfValue: number }>;
  driftDirection: { goals: number; value: number; averageGapPp: FundSplit };
  largestDriftedGoals: Array<{
    goalNumber: string;
    accountNumber: string;
    goalCategory: string;
    riskScore: number | null;
    value: number;
    driftPp: number;
    actualSplit: FundSplit;
    targetSplit: FundSplit;
  }>;
  dataIssues: { goalsWithNegativeFundBalance: number; fundedGoalsWithoutTargetSplit: number };
}

interface SuitabilityReview {
  scope: string;
  rules: Array<{
    rule: string;
    label: string;
    flagged: number;
    value: number;
    items: Array<{
      accountNumber: string;
      goalNumber: string | null;
      ageYears: number | null;
      value: number;
      actualEquityPct: number | null;
      targetEquityPct: number | null;
      riskScore: number | null;
    }>;
  }>;
}

const FUND_NAMES: Record<string, string> = {
  XUMMF: "Money market",
  XUBF: "Bond",
  XUDEF: "Domestic equity",
  XUREF: "Regional equity",
};

const formatPoints = (value: number | null | undefined) =>
  value === null || value === undefined ? "–" : `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;

const formatSplit = (split: FundSplit) =>
  FUND_CODES.map((code) => (split[code] === null ? "–" : Math.round(split[code] as number))).join(" / ");

/** Drift bands rendered with the shared bar list (rows carry goal counts in "accounts"). */
const toDriftBreakdown = (bands: RiskAllocationReport["driftBands"]): Breakdown => {
  const totalGoals = bands.reduce((s, b) => s + b.goals, 0);
  return {
    dimension: "drift",
    label: "Distance from target split (largest fund gap)",
    knownShareOfAccounts: 1,
    knownShareOfAum: 1,
    rows: bands.map((b) => ({
      key: b.band,
      accounts: b.goals,
      aum: b.value,
      shareOfAccounts: totalGoals ? b.goals / totalGoals : 0,
      shareOfAum: b.shareOfValue,
      medianBalance: null,
      averageBalance: b.goals ? b.value / b.goals : null,
    })),
  };
};

/**
 * Risk and allocation of funded goals: value by risk score with actual vs target
 * equity share, value by goal category, drift of holdings from Ultima's target
 * split, the largest drifted goals, and the suitability review list.
 */
const RiskAllocation = () => {
  const [segment, setSegment] = useState<InsightSegment>("INDIVIDUAL");
  const [genderView, setGenderView] = useState<GenderView>("IDENTIFIED");
  const [genderSplit, setGenderSplit] = useState<GenderSplitMode>("OFF");
  const [report, setReport] = useState<RiskAllocationReport | null>(null);
  const [review, setReview] = useState<SuitabilityReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { asOf } = useInsightAsOf();

  useEffect(() => {
    let active = true;
    loadReport(segment, genderView, () => active);
    // A slower, older request (e.g. a date still being prepared) must not overwrite newer figures
    return () => {
      active = false;
    };
  }, [segment, genderView, asOf]);

  const loadReport = async (selected: InsightSegment, view: GenderView, isActive: () => boolean = () => true) => {
    try {
      setLoading(true);
      setError(null);
      const [risk, suitability] = await Promise.all([fetchRiskAllocation(selected, 50, asOf, view), fetchSuitabilityReview(25, asOf)]);
      if (!isActive()) return;
      setReport(risk);
      setReview(suitability);
    } catch (err: any) {
      console.error("Failed to load risk & allocation:", err);
      if (isActive()) setError(err.message || "Failed to load risk & allocation");
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  const drifted = report?.driftDirection;
  const splitView = segment !== "INSTITUTIONAL" && genderSplit === "ON" ? genderView : undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup options={SEGMENT_OPTIONS} value={segment} onChange={setSegment} />
          {segment !== "INSTITUTIONAL" && (
            <GenderControls view={genderView} onViewChange={setGenderView} split={genderSplit} onSplitChange={setGenderSplit} />
          )}
          {splitView && <GenderLegend />}
        </div>
        <p className="text-sm text-gray-600">
          Funded goals (UGX 5,000+). Target split = Ultima's current allocation for each goal.
        </p>
      </div>

      {loading && <LoadingPanel />}
      {error && !loading && <ErrorPanel message={error} onRetry={() => loadReport(segment, genderView)} />}

      {report && review && !loading && !error && drifted && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Value in funded goals" value={formatUGXCompact(report.totalValue)} hint="At latest mid prices" />
            <StatTile
              label={`Goals ${report.driftTolerancePp}+ points off target`}
              value={formatCount(drifted.goals)}
              hint={`Holding ${formatUGXCompact(drifted.value)}`}
            />
            <StatTile
              label="Drifted goals lean towards"
              value={formatPoints(drifted.averageGapPp.XUBF) + " bond"}
              hint={`Regional equity ${formatPoints(drifted.averageGapPp.XUREF)}, domestic equity ${formatPoints(drifted.averageGapPp.XUDEF)}`}
            />
            <StatTile
              label="Data issues"
              value={formatCount(report.dataIssues.goalsWithNegativeFundBalance)}
              hint={`goals with a negative fund balance · ${formatCount(report.dataIssues.fundedGoalsWithoutTargetSplit)} without a target split`}
            />
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Value by risk score</h2>
            <p className="text-sm text-gray-500 mb-4">
              Equity share = domestic + regional equity funds, weighted by goal value. Higher scores should hold more equity.
              {splitView && ` Female / male value is by the goal holder's declared gender. ${report.genderNote}`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="text-left py-2 font-medium">Risk score</th>
                    <th className="text-right py-2 font-medium">Goals</th>
                    <th className="text-right py-2 font-medium">Value</th>
                    <th className="text-left py-2 pl-6 font-medium">Share of value</th>
                    <th className="text-right py-2 font-medium">Equity: actual</th>
                    <th className="text-right py-2 font-medium">Equity: target</th>
                    <th className="text-right py-2 font-medium">Gap</th>
                    {splitView && <th className="text-left py-2 pl-6 font-medium">Female / male value</th>}
                  </tr>
                </thead>
                <tbody>
                  {report.byRiskScore.map((row) => {
                    const gap =
                      row.actualEquityPct !== null && row.targetEquityPct !== null
                        ? row.actualEquityPct - row.targetEquityPct
                        : null;
                    return (
                      <tr key={String(row.riskScore)} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 text-gray-900">{row.riskScore === null ? "No score" : row.riskScore}</td>
                        <td className="py-2 text-right text-gray-900">{formatCount(row.goals)}</td>
                        <td className="py-2 text-right text-gray-900">{formatUGXCompact(row.value)}</td>
                        <td className="py-2 pl-6">
                          <div className="flex items-center gap-3">
                            <ShareBar share={row.shareOfValue} widthClass="w-32" />
                            <span className="text-gray-900 w-12 text-right">{formatPct(row.shareOfValue)}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right text-gray-900">{row.actualEquityPct === null ? "–" : `${row.actualEquityPct.toFixed(1)}%`}</td>
                        <td className="py-2 text-right text-gray-900">{row.targetEquityPct === null ? "–" : `${row.targetEquityPct.toFixed(1)}%`}</td>
                        <td className="py-2 text-right text-gray-600">{formatPoints(gap)}</td>
                        {splitView && (
                          <td className="py-2 pl-6 w-48">
                            <GenderSplitBar split={row.gender} measure="value" view={splitView} countLabel="goals" />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BreakdownBarList breakdown={report.byGoalCategory} metric="aum" countLabel="goals" genderSplitView={splitView} />
            <div className="space-y-6">
              <BreakdownBarList breakdown={toDriftBreakdown(report.driftBands)} metric="aum" countLabel="goals" />
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-base font-semibold text-gray-900 mb-3">
                  Which way drifted goals lean ({formatCount(drifted.goals)} goals)
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {FUND_CODES.map((code) => (
                      <tr key={code} className="border-b border-gray-100">
                        <td className="py-1.5 text-gray-900">{FUND_NAMES[code]} ({code})</td>
                        <td className="py-1.5 text-right text-gray-900">{formatPoints(drifted.averageGapPp[code])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500 mt-3">
                  Value-weighted average of actual minus target share. Likely causes: deposits made before the client's
                  current risk score, withdrawals taken from equity, and price moves; holdings are not rebalanced.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Largest goals off target</h2>
            <p className="text-sm text-gray-500 mb-4">
              Splits shown as Money market / Bond / Domestic equity / Regional equity, in %.
            </p>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="text-left py-2 font-medium">Goal</th>
                    <th className="text-left py-2 font-medium">Category</th>
                    <th className="text-right py-2 font-medium">Score</th>
                    <th className="text-right py-2 font-medium">Value</th>
                    <th className="text-right py-2 font-medium">Actual split</th>
                    <th className="text-right py-2 font-medium">Target split</th>
                    <th className="text-right py-2 font-medium">Largest gap</th>
                  </tr>
                </thead>
                <tbody>
                  {report.largestDriftedGoals.map((goal) => (
                    <tr key={goal.goalNumber} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-mono text-gray-900">{goal.goalNumber}</td>
                      <td className="py-2 text-gray-600">{formatGroupLabel(goal.goalCategory)}</td>
                      <td className="py-2 text-right text-gray-900">{goal.riskScore ?? "–"}</td>
                      <td className="py-2 text-right text-gray-900">{formatUGX(goal.value)}</td>
                      <td className="py-2 text-right font-mono text-gray-900">{formatSplit(goal.actualSplit)}</td>
                      <td className="py-2 text-right font-mono text-gray-600">{formatSplit(goal.targetSplit)}</td>
                      <td className="py-2 text-right text-gray-900">{goal.driftPp.toFixed(1)} pts</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Suitability review</h2>
            <div className="flex items-start gap-2 text-sm text-gray-600 mb-4">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
              <p>
                {review.scope}. These rules flag cases for a person to review; they are not judgements of unsuitability.
                Ages come from Ultima sign-up data, so clients without a date of birth cannot be flagged by age rules.
              </p>
            </div>
            <div className="space-y-5">
              {review.rules.map((rule) => (
                <div key={rule.rule}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      <AlertTriangle className={`w-4 h-4 ${rule.flagged ? "text-amber-500" : "text-gray-300"}`} />
                      {rule.label}
                    </div>
                    <span className="text-sm text-gray-600">
                      {formatCount(rule.flagged)} flagged · {formatUGXCompact(rule.value)}
                    </span>
                  </div>
                  {rule.items.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-gray-500 text-xs">
                            <th className="text-left py-1.5 font-medium">Account</th>
                            <th className="text-left py-1.5 font-medium">Goal</th>
                            <th className="text-right py-1.5 font-medium">Age</th>
                            <th className="text-right py-1.5 font-medium">Value</th>
                            <th className="text-right py-1.5 font-medium">Equity actual / target</th>
                            <th className="text-right py-1.5 font-medium">Risk score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rule.items.map((item) => (
                            <tr key={`${item.accountNumber}-${item.goalNumber}`} className="border-b border-gray-100">
                              <td className="py-1.5 font-mono text-gray-900">{item.accountNumber}</td>
                              <td className="py-1.5 font-mono text-gray-600">{item.goalNumber ?? "Whole account"}</td>
                              <td className="py-1.5 text-right text-gray-900">{item.ageYears ?? "–"}</td>
                              <td className="py-1.5 text-right text-gray-900">{formatUGX(item.value)}</td>
                              <td className="py-1.5 text-right text-gray-900">
                                {item.actualEquityPct === null
                                  ? "–"
                                  : `${item.actualEquityPct.toFixed(1)}% / ${item.targetEquityPct?.toFixed(1) ?? "–"}%`}
                              </td>
                              <td className="py-1.5 text-right text-gray-900">{item.riskScore ?? "–"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rule.flagged > rule.items.length && (
                        <p className="text-xs text-gray-500 mt-1">
                          Showing the {rule.items.length} largest of {formatCount(rule.flagged)}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RiskAllocation;
