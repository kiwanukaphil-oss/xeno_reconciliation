import {
  formatCount,
  formatGroupLabel,
  formatPct,
  formatUGX,
  formatUGXCompact,
  isUnknownGroup,
} from "./insightFormat";

export interface BreakdownRow {
  key: string;
  accounts: number;
  aum: number;
  shareOfAccounts: number;
  shareOfAum: number;
  medianBalance: number | null;
  averageBalance: number | null;
}

export interface Breakdown {
  dimension: string;
  label: string;
  rows: BreakdownRow[];
  knownShareOfAccounts: number;
  knownShareOfAum: number;
}

export type InsightMetric = "aum" | "accounts";

interface BreakdownBarListProps {
  breakdown: Breakdown;
  metric: InsightMetric;
  /** What the row count counts (rows reuse the "accounts" field for goal counts too). */
  countLabel?: "accounts" | "goals";
}

/**
 * One breakdown as a ranked list of thin horizontal bars (single hue; Unknown and
 * folded "Other" rows in gray). Bar length is relative to the largest row so small
 * differences stay visible; the printed share is the true share of the total.
 * Hovering a row shows its full figures.
 */
export const BreakdownBarList = ({ breakdown, metric, countLabel = "accounts" }: BreakdownBarListProps) => {
  const shortCountLabel = countLabel === "goals" ? "goals" : "accts";
  const shareOf = (row: BreakdownRow) =>
    metric === "aum" ? row.shareOfAum : row.shareOfAccounts;
  const maxShare = Math.max(...breakdown.rows.map(shareOf), 0.0001);
  const hasUnknownBucket = breakdown.rows.some((r) => r.key === "UNKNOWN");

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-baseline justify-between mb-4 gap-4">
        <h3 className="text-base font-semibold text-gray-900">{breakdown.label}</h3>
        {hasUnknownBucket && (
          <span className="text-xs text-gray-500 text-right">
            Known for {formatPct(breakdown.knownShareOfAccounts, 0)} of accounts ·{" "}
            {formatPct(breakdown.knownShareOfAum, 0)} of AUM
          </span>
        )}
      </div>

      {breakdown.rows.length === 0 ? (
        <p className="text-sm text-gray-500">No data</p>
      ) : (
        <div className="space-y-3">
          {breakdown.rows.map((row) => {
            const share = shareOf(row);
            const tooltip = [
              formatGroupLabel(row.key),
              `${formatCount(row.accounts)} ${countLabel} (${formatPct(row.shareOfAccounts)})`,
              `AUM ${formatUGX(row.aum)} (${formatPct(row.shareOfAum)})`,
              `Median ${countLabel === "goals" ? "goal value" : "balance"} ${formatUGX(row.medianBalance)}`,
            ].join("\n");
            return (
              <div key={row.key} title={tooltip} className="group cursor-default">
                <div className="flex items-center justify-between text-sm mb-1 gap-3">
                  <span className="text-gray-900 truncate group-hover:font-medium">
                    {formatGroupLabel(row.key)}
                  </span>
                  <span className="whitespace-nowrap">
                    <span className="font-semibold text-gray-900">{formatPct(share)}</span>
                    <span className="text-gray-500 ml-2 text-xs">
                      {metric === "aum"
                        ? formatUGXCompact(row.aum)
                        : `${formatCount(row.accounts)} ${shortCountLabel}`}
                    </span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      isUnknownGroup(row.key) ? "bg-gray-400" : "bg-blue-600"
                    }`}
                    style={{ width: `${Math.max((share / maxShare) * 100, share > 0 ? 1 : 0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
