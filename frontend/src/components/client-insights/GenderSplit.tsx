// Gender view and female/male split controls shared by the Client Insights pages
import type { GenderView } from "../../services/api";
import { formatCount, formatPct } from "./insightFormat";
import { ToggleGroup } from "./InsightControls";

/** Female/male figures for one group, as returned by the API (see GenderAllocation.ts). */
export interface GenderSplit {
  femaleCount: number;
  maleCount: number;
  femaleValue: number;
  maleValue: number;
  identifiedCount: number;
  unidentifiedCount: number;
  femaleShareOfCount: number | null;
  femaleShareOfValue: number | null;
  basis: "IDENTIFIED_ONLY" | "OWN_RATIO" | "SEGMENT_RATIO" | "NONE";
}

export type GenderSplitMode = "OFF" | "ON";

// Categorical slots 1 and 2 of the validated chart palette; identity is also carried by the legend and labels
const FEMALE_COLOR = "#2a78d6";
const MALE_COLOR = "#eb6834";

export const GENDER_VIEW_OPTIONS: Array<{ value: GenderView; label: string }> = [
  { value: "IDENTIFIED", label: "Gender identified" },
  { value: "ALLOCATED", label: "All clients (allocated)" },
];

const SPLIT_OPTIONS: Array<{ value: GenderSplitMode; label: string }> = [
  { value: "OFF", label: "No gender split" },
  { value: "ON", label: "Split by gender" },
];

/** The two gender toggles: which view, and whether other sections show a female/male split. */
export const GenderControls = ({
  view,
  onViewChange,
  split,
  onSplitChange,
}: {
  view: GenderView;
  onViewChange: (view: GenderView) => void;
  split?: GenderSplitMode;
  onSplitChange?: (split: GenderSplitMode) => void;
}) => (
  <>
    <ToggleGroup options={GENDER_VIEW_OPTIONS} value={view} onChange={onViewChange} />
    {split && onSplitChange && <ToggleGroup options={SPLIT_OPTIONS} value={split} onChange={onSplitChange} />}
  </>
);

export const GenderLegend = () => (
  <span className="inline-flex items-center gap-3 text-xs text-gray-600">
    <span className="inline-flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FEMALE_COLOR }} /> Female
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: MALE_COLOR }} /> Male
    </span>
  </span>
);

/** Plain-language summary of how a split was produced, for tooltips. */
export const describeSplit = (split: GenderSplit, view: GenderView, countLabel = "accounts") => {
  const identified = `${formatCount(split.identifiedCount)} identified ${countLabel}`;
  if (view === "IDENTIFIED") return `${identified}; ${formatCount(split.unidentifiedCount)} without a declared gender left out`;
  if (split.basis === "OWN_RATIO") return `${identified}; ${formatCount(split.unidentifiedCount)} others allocated by this group's ratio`;
  if (split.basis === "SEGMENT_RATIO")
    return `${identified} (too few for its own ratio); ${formatCount(split.unidentifiedCount)} others allocated by the overall ratio`;
  return identified;
};

/**
 * Thin two-part bar of the female and male shares of one group, with the shares
 * printed beside it. measure picks counts (accounts or goals) or value (AUM). Shows a
 * dash where the group has too few identified clients to report a split.
 */
export const GenderSplitBar = ({
  split,
  measure,
  view,
  countLabel = "accounts",
  widthClass = "w-full",
}: {
  split: GenderSplit | undefined;
  measure: "count" | "value";
  view: GenderView;
  countLabel?: string;
  widthClass?: string;
}) => {
  const female = split ? (measure === "count" ? split.femaleShareOfCount : split.femaleShareOfValue) : null;
  // Fewer than 5 identified clients cannot be split without singling someone out
  if (!split || female === null || split.identifiedCount < 5) {
    return <p className="text-xs text-gray-400">Gender split: too few identified</p>;
  }
  return (
    <div className={`flex items-center gap-2 ${widthClass}`} title={describeSplit(split, view, countLabel)}>
      <div className="flex-1 flex h-1.5 gap-0.5">
        <div className="h-1.5 rounded-l-full" style={{ width: `${female * 100}%`, backgroundColor: FEMALE_COLOR }} />
        <div className="h-1.5 rounded-r-full" style={{ width: `${(1 - female) * 100}%`, backgroundColor: MALE_COLOR }} />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap">
        F {formatPct(female, 0)} · M {formatPct(1 - female, 0)}
      </span>
    </div>
  );
};
