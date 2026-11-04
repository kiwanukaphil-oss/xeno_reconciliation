import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { fetchInsightAsOfDates, type InsightAsOf, onInsightSnapshotPreparing, type SnapshotDateInfo } from "../../services/api";
import { formatDate } from "./insightFormat";

// Remembered for the browser tab, so the chosen date carries across Client Insights pages and reloads
const STORAGE_KEY = "client-insights-as-of";
const OTHER_DATE = "__other__";
const DATES_QUERY_KEY = ["insight-as-of-dates"];

interface InsightAsOfState {
  /** YYYY-MM-DD, or null for Latest. */
  asOf: InsightAsOf;
  setAsOf: (asOf: InsightAsOf) => void;
  /** Date whose figures are being prepared right now, if any. */
  preparingAsOf: string | null;
}

const InsightAsOfContext = createContext<InsightAsOfState>({ asOf: null, setAsOf: () => undefined, preparingAsOf: null });

/** The as-at date chosen for Client Insights pages (null = Latest). */
export const useInsightAsOf = () => useContext(InsightAsOfContext);

/** Holds the chosen as-at date and tracks when a page is waiting for that date to be prepared. */
export const InsightAsOfProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [asOf, setAsOfState] = useState<InsightAsOf>(() => sessionStorage.getItem(STORAGE_KEY) || null);
  const [preparingAsOf, setPreparingAsOf] = useState<string | null>(null);

  useEffect(
    () =>
      onInsightSnapshotPreparing((date, preparing) => {
        setPreparingAsOf((current) => (preparing ? date : current === date ? null : current));
        // Statuses in the selector change when a date starts or finishes preparing
        queryClient.invalidateQueries({ queryKey: DATES_QUERY_KEY });
      }),
    [queryClient]
  );

  const setAsOf = (next: InsightAsOf) => {
    if (next) sessionStorage.setItem(STORAGE_KEY, next);
    else sessionStorage.removeItem(STORAGE_KEY);
    setAsOfState(next);
  };

  return <InsightAsOfContext.Provider value={{ asOf, setAsOf, preparingAsOf }}>{children}</InsightAsOfContext.Provider>;
};

const STATUS_HINTS: Record<SnapshotDateInfo["status"], string> = {
  READY: "",
  NOT_BUILT: " · prepared on first use",
  BUILDING: " · preparing",
  STALE: " · will refresh",
  FAILED: " · last attempt failed",
};

/**
 * Bar shown above every Client Insights page: picks the as-at date (Latest, a month-end, or any
 * other date) and states plainly which dates the figures on the page describe.
 */
export const InsightAsOfBar = () => {
  const { asOf, setAsOf, preparingAsOf } = useInsightAsOf();
  const { data } = useQuery({ queryKey: DATES_QUERY_KEY, queryFn: fetchInsightAsOfDates, staleTime: 60_000 });
  const [choosingOther, setChoosingOther] = useState(false);

  const periodEnds = useMemo(() => (data?.dates ?? []).filter((d) => d.isPeriodEnd), [data]);
  const otherDates = useMemo(() => (data?.dates ?? []).filter((d) => !d.isPeriodEnd), [data]);
  const selected = data?.dates.find((d) => d.asOf === asOf);
  const isListed = asOf === null || !!selected;
  const selectValue = choosingOther || !isListed ? OTHER_DATE : asOf ?? "";

  const onSelect = (value: string) => {
    if (value === OTHER_DATE) {
      setChoosingOther(true);
      return;
    }
    setChoosingOther(false);
    setAsOf(value || null);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-blue-600" />
        <label htmlFor="insight-as-of" className="text-sm font-medium text-gray-700">
          Figures as at
        </label>
        <select
          id="insight-as-of"
          value={selectValue}
          onChange={(e) => onSelect(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
        >
          <option value="">Latest{data ? ` (${formatDate(data.latest.transactions)})` : ""}</option>
          <optgroup label="Month-ends">
            {periodEnds.map((d) => (
              <option key={d.asOf} value={d.asOf}>
                {formatDate(d.asOf)}
                {STATUS_HINTS[d.status]}
              </option>
            ))}
          </optgroup>
          {otherDates.length > 0 && (
            <optgroup label="Other dates prepared">
              {otherDates.map((d) => (
                <option key={d.asOf} value={d.asOf}>
                  {formatDate(d.asOf)}
                  {STATUS_HINTS[d.status]}
                </option>
              ))}
            </optgroup>
          )}
          <option value={OTHER_DATE}>Other date...</option>
        </select>
        {selectValue === OTHER_DATE && (
          <input
            type="date"
            aria-label="Choose an as-at date"
            value={asOf ?? ""}
            max={data?.latest.transactions}
            onChange={(e) => e.target.value && setAsOf(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1"
          />
        )}
      </div>

      <div className="text-sm text-gray-600">
        {preparingAsOf && preparingAsOf === asOf ? (
          <span className="flex items-center gap-1.5 text-blue-700">
            <Loader2 className="w-4 h-4 animate-spin" />
            Preparing figures as at {formatDate(preparingAsOf)} (about a minute the first time)
          </span>
        ) : asOf === null ? (
          data && (
            <>
              Transactions to {formatDate(data.latest.transactions)} · prices of {formatDate(data.latest.prices)}
            </>
          )
        ) : (
          <>
            <span className="font-medium text-gray-900">As at {formatDate(asOf)}</span>
            {" · "}transactions up to this date · prices of {formatDate(selected?.priceAsOf ?? asOf)}
          </>
        )}
      </div>

      {asOf !== null && (
        <p className="w-full text-xs text-gray-500">
          Balances, activity and "last 12 months" are as at this date. Client profile details (gender, location, sign-up channel),
          goal risk scores and goal targets are current Ultima values.
        </p>
      )}
    </div>
  );
};
