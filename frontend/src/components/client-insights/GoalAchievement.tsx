import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { fetchGoalAchievement, type InsightSegment } from "../../services/api";
import { ErrorPanel, LoadingPanel, ShareBar, StatTile, ToggleGroup } from "./InsightControls";
import { formatCount, formatDate, formatGroupLabel, formatPct, formatUGX, formatUGXCompact, SEGMENT_OPTIONS } from "./insightFormat";

interface AchievementRow {
  key: string;
  goals: number;
  everReached: number;
  reachedHolding: number;
  reachedUsed: number;
  everReachedRate: number | null;
  reachedUsedRate: number | null;
  medianProgress: number | null;
  medianTarget: number | null;
}

interface CountRow {
  key: string;
  goals: number;
  value: number;
  share: number | null;
}

interface GoalAchievementReport {
  asOf: { ultimaSnapshot: string; transactions: string };
  headline: {
    goals: number;
    goalsWithTarget: number;
    goalsWithPlausibleTarget: number;
    everReached: number;
    reachedHolding: number;
    reachedUsed: number;
    inProgress: number;
    targetSettingRate: number | null;
    everReachedRate: number | null;
    reachedHoldingRate: number | null;
    reachedUsedRate: number | null;
  };
  statuses: CountRow[];
  progressBands: CountRow[];
  paceBands: CountRow[];
  targetSetting: Array<{
    key: string;
    goals: number;
    medianValue: number | null;
    savedInLast12MonthsRate: number | null;
    medianDepositsLast12Months: number | null;
    medianAmountLast12Months: number | null;
  }>;
  trend: Array<{ asOf: string; goalsWithTarget: number; atTarget: number; atTargetRate: number | null }>;
  breakdowns: Array<{ dimension: string; label: string; weighted?: boolean; rows: AchievementRow[] }>;
}

const STATUS_LABELS: Record<string, string> = {
  REACHED_HOLDING: "Reached target, still holding it",
  REACHED_USED: "Reached target, then used the savings",
  IN_PROGRESS: "On the way to target",
  NOT_STARTED: "Target set, no savings yet",
  NO_TARGET: "No target set",
  TARGET_OUT_OF_RANGE: "Target under UGX 10k or over 10bn (not rated)",
};
// Achieved statuses first, then the rest in order of the journey
const STATUS_ORDER = ["REACHED_HOLDING", "REACHED_USED", "IN_PROGRESS", "NOT_STARTED", "NO_TARGET", "TARGET_OUT_OF_RANGE"];

const DIMENSION_OPTIONS = [
  { value: "targetSize", label: "Target size" },
  { value: "goalCategory", label: "Goal category" },
  { value: "gender", label: "Gender" },
  { value: "signupChannel", label: "Channel" },
  { value: "locationGroup", label: "Location" },
  { value: "ageBand", label: "Age" },
  { value: "riskScore", label: "Risk score" },
];

const Card = ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </div>
);

/** Table of goal counts per band with a share bar (pace and progress of goals on the way). */
const BandTable = ({ rows, header }: { rows: CountRow[]; header: string }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-gray-200 text-gray-600">
        <th className="text-left py-2 font-medium">{header}</th>
        <th className="text-right py-2 font-medium">Goals</th>
        <th className="text-left py-2 pl-6 font-medium">Share</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr key={r.key} className="border-b border-gray-100">
          <td className="py-2 text-gray-900">{formatGroupLabel(r.key)}</td>
          <td className="py-2 text-right text-gray-900">{formatCount(r.goals)}</td>
          <td className="py-2 pl-6">
            <div className="flex items-center gap-3">
              <ShareBar share={r.share ?? 0} widthClass="w-32" />
              <span className="text-gray-900 w-12 text-right">{formatPct(r.share, 0)}</span>
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * Goal achievement against Ultima targets. Counts goals that reached their
 * target and still hold it, and goals that reached it and then used the money
 * (worked out from the system's transactions), with breakdowns by goal and client
 * profile, the saving pace of goals still on the way, and the snapshot trend.
 */
const GoalAchievement = () => {
  const [segment, setSegment] = useState<InsightSegment>("INDIVIDUAL");
  const [dimension, setDimension] = useState("targetSize");

  const { data: report, error, isPending, refetch } = useQuery<GoalAchievementReport>({
    queryKey: ["goal-achievement", segment],
    queryFn: () => fetchGoalAchievement(segment),
  });

  if (isPending) return <LoadingPanel message="Working out goal achievement..." />;
  if (error || !report) return <ErrorPanel message={(error as Error)?.message ?? "No data"} onRetry={() => refetch()} />;

  const { headline } = report;
  const breakdown = report.breakdowns.find((b) => b.dimension === dimension);
  const statuses = [...report.statuses]
    .filter((s) => STATUS_LABELS[s.key])
    .sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
  const maxRate = Math.max(...(breakdown?.rows.map((r) => r.everReachedRate ?? 0) ?? [0]), 0.01);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup options={SEGMENT_OPTIONS} value={segment} onChange={setSegment} />
        <p className="text-sm text-gray-600">
          Ultima goal statistics of {formatDate(report.asOf.ultimaSnapshot)} · transactions to {formatDate(report.asOf.transactions)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Goals with a target"
          value={formatPct(headline.targetSettingRate, 0)}
          hint={`${formatCount(headline.goalsWithTarget)} of ${formatCount(headline.goals)} goals`}
        />
        <StatTile
          label="Reached their target"
          value={formatPct(headline.everReachedRate, 1)}
          hint={`${formatCount(headline.everReached)} of ${formatCount(headline.goalsWithPlausibleTarget)} goals with a target`}
        />
        <StatTile label="Reached and still holding" value={formatPct(headline.reachedHoldingRate, 1)} hint={`${formatCount(headline.reachedHolding)} goals`} />
        <StatTile label="Reached, then used the savings" value={formatPct(headline.reachedUsedRate, 1)} hint={`${formatCount(headline.reachedUsed)} goals, e.g. fees paid`} />
      </div>

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-900">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          Targets and current values come from Ultima. A goal counts as "reached, then used" when its net deposits in this system reached
          the target but its value is now below it, typically because the client withdrew for what they saved for. Deposits exclude
          investment growth, so this is a conservative count. Rates cover goals with a target of UGX 10k to 10bn.
        </p>
      </div>

      <Card title="Where goals stand" subtitle="Every goal in the Ultima goal statistics, by status">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-right py-2 font-medium">Goals</th>
              <th className="text-left py-2 pl-6 font-medium">Share of goals</th>
              <th className="text-right py-2 font-medium">Current value</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.key} className="border-b border-gray-100">
                <td className="py-2 text-gray-900">{STATUS_LABELS[s.key]}</td>
                <td className="py-2 text-right text-gray-900">{formatCount(s.goals)}</td>
                <td className="py-2 pl-6">
                  <div className="flex items-center gap-3">
                    <ShareBar share={s.share ?? 0} widthClass="w-40" />
                    <span className="text-gray-900 w-12 text-right">{formatPct(s.share, 1)}</span>
                  </div>
                </td>
                <td className="py-2 text-right text-gray-900">{formatUGXCompact(s.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Who reaches their targets"
        subtitle="Goals with a target. Smaller targets are reached far more often, so compare groups with their median target in view."
      >
        <div className="mb-4">
          <ToggleGroup options={DIMENSION_OPTIONS} value={dimension} onChange={setDimension} />
        </div>
        {breakdown && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="text-left py-2 font-medium">{breakdown.label}</th>
                  <th className="text-right py-2 font-medium">Goals</th>
                  <th className="text-left py-2 pl-6 font-medium">Reached target (holding or used)</th>
                  <th className="text-right py-2 font-medium">Reached and used</th>
                  <th className="text-right py-2 font-medium">Median target</th>
                  <th className="text-right py-2 font-medium">Median progress (on the way)</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.rows.map((r) => (
                  <tr key={r.key} className="border-b border-gray-100">
                    <td className={`py-2 ${r.key === "UNKNOWN" || r.key.startsWith("Other") || r.key === "Not estimable" ? "text-gray-500" : "text-gray-900"}`}>
                      {formatGroupLabel(r.key)}
                    </td>
                    <td className="py-2 text-right text-gray-900">{formatCount(r.goals)}</td>
                    <td className="py-2 pl-6">
                      <div className="flex items-center gap-3">
                        <ShareBar share={(r.everReachedRate ?? 0) / maxRate} widthClass="w-40" />
                        <span className="text-gray-900 w-14 text-right">{formatPct(r.everReachedRate, 1)}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right text-gray-900">{formatPct(r.reachedUsedRate, 1)}</td>
                    <td className="py-2 text-right text-gray-900">{formatUGX(r.medianTarget)}</td>
                    <td className="py-2 text-right text-gray-900">{formatPct(r.medianProgress, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {breakdown.weighted && (
              <p className="text-xs text-gray-500 mt-3">
                Probability-weighted: declared gender, else estimated from the client's name, so goal counts are estimates. Medians are
                not available for weighted groups.
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2">Bars are scaled to the highest rate shown.</p>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          title="Goals on the way: time to target"
          subtitle={`At each goal's net saving rate over the last 12 months of data (to ${formatDate(report.asOf.transactions)}). Ultima has no target dates, so this is pace, not "on track".`}
        >
          <BandTable rows={report.paceBands} header="Time to target" />
        </Card>
        <Card title="Goals on the way: progress" subtitle="Current value as a share of the target">
          <BandTable rows={report.progressBands} header="Progress" />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="With or without a target" subtitle="Saving activity over the last 12 months of data">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600">
                <th className="text-left py-2 font-medium">Goals</th>
                <th className="text-right py-2 font-medium">Number</th>
                <th className="text-right py-2 font-medium">Deposited in 12m</th>
                <th className="text-right py-2 font-medium">Median deposits</th>
                <th className="text-right py-2 font-medium">Median amount</th>
              </tr>
            </thead>
            <tbody>
              {report.targetSetting.map((t) => (
                <tr key={t.key} className="border-b border-gray-100">
                  <td className="py-2 text-gray-900">{t.key === "WITH_TARGET" ? "With a target" : "No target"}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(t.goals)}</td>
                  <td className="py-2 text-right text-gray-900">{formatPct(t.savedInLast12MonthsRate, 0)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(t.medianDepositsLast12Months)}</td>
                  <td className="py-2 text-right text-gray-900">{formatUGX(t.medianAmountLast12Months)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-3">Median deposits and amount are among goals that deposited in the period.</p>
        </Card>

        <Card title="Trend" subtitle="Goals at target in each Ultima goal statistics snapshot">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600">
                <th className="text-left py-2 font-medium">Snapshot</th>
                <th className="text-right py-2 font-medium">Goals with a target</th>
                <th className="text-right py-2 font-medium">At target</th>
                <th className="text-right py-2 font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {report.trend.map((t) => (
                <tr key={t.asOf} className="border-b border-gray-100">
                  <td className="py-2 text-gray-900">{formatDate(t.asOf)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(t.goalsWithTarget)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(t.atTarget)}</td>
                  <td className="py-2 text-right text-gray-900">{formatPct(t.atTargetRate, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.trend.length < 2 && (
            <p className="text-xs text-gray-500 mt-3">
              One snapshot so far. Import each month's Ultima Goal Stats export with the profile import to build the trend.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
};

export default GoalAchievement;
