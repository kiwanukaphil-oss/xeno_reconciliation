import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Loader2, Search } from "lucide-react";
import { accountProfilesExportUrl, fetchAccountProfiles, type AccountDirectoryQuery, type InsightSegment } from "../../services/api";
import { ErrorPanel, ToggleGroup } from "./InsightControls";
import { useInsightAsOf } from "./InsightAsOf";
import { formatCount, formatDate, formatGroupLabel, formatUGX, formatUGXCompact, SEGMENT_OPTIONS } from "./insightFormat";
import AccountProfileDetail from "./AccountProfileDetail";

type SortKey = NonNullable<AccountDirectoryQuery["sort"]>;

interface DirectoryRow {
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  clientName: string;
  balance: number;
  isFunded: boolean;
  gender: string;
  ageYears: number | null;
  location: string | null;
  region: string | null;
  signupChannel: string;
  phoneNetwork: string;
  lastDepositDate: string | null;
  depositsLast12Months: number;
  contactClosed: boolean;
  missing: string[];
}

interface DirectoryPage {
  page: number;
  pageSize: number;
  totalAccounts: number;
  totalAum: number;
  rows: DirectoryRow[];
}

interface DirectoryFilters {
  segment: InsightSegment;
  funded: "FUNDED" | "UNFUNDED" | "ALL";
  channel: string;
  gender: string;
  missing: string;
  minBalance: string;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

const FUNDED_OPTIONS = [
  { value: "FUNDED", label: "Funded (UGX 5,000+)" },
  { value: "UNFUNDED", label: "Unfunded" },
  { value: "ALL", label: "All balances" },
];
const MISSING_OPTIONS = [
  { value: "", label: "Any completeness" },
  { value: "ANY", label: "Missing anything" },
  { value: "GENDER", label: "Missing gender" },
  { value: "DATE_OF_BIRTH", label: "Missing date of birth" },
  { value: "LOCATION", label: "Missing location" },
  { value: "NO_PROFILE", label: "No Ultima profile" },
];
const CHANNEL_OPTIONS = [
  { value: "", label: "All channels" },
  { value: "MTN", label: "MTN" },
  { value: "APP", label: "App" },
  { value: "WEB", label: "Web" },
  { value: "YOLLO", label: "Yollo" },
  { value: "UNKNOWN", label: "Unknown channel" },
];
const GENDER_OPTIONS = [
  { value: "", label: "Any gender" },
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "UNDISCLOSED", label: "Rather not say" },
  { value: "UNKNOWN", label: "Not declared" },
];

const INITIAL_FILTERS: DirectoryFilters = {
  segment: "ALL",
  funded: "FUNDED",
  channel: "",
  gender: "",
  missing: "",
  minBalance: "",
};

/** Declared gender as Ultima holds it; "Not declared" in muted ink. */
export const GenderCell = ({ gender }: { gender: string }) => {
  if (gender === "FEMALE" || gender === "MALE") return <span className="text-gray-900">{formatGroupLabel(gender)}</span>;
  if (gender === "UNDISCLOSED") return <span className="text-gray-900">Rather not say</span>;
  return <span className="text-gray-400">Not declared</span>;
};

/** Returns the value once it has stopped changing for the given delay. */
const useDebouncedValue = <T,>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

const FilterSelect = ({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  label: string;
}) => (
  <select
    aria-label={label}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

/**
 * Searchable directory of client accounts with their Ultima profile and what is
 * missing, for KYC follow-up and lookups. Paging, sorting and filtering run on the
 * server; the previous page stays on screen while the next loads, the following
 * page is prefetched, and search waits until typing pauses. Export streams every
 * matching account to Excel. Gender is the declared Ultima value only.
 */
const AccountProfiles = () => {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const [filters, setFilters] = useState<DirectoryFilters>(INITIAL_FILTERS);
  const [sort, setSort] = useState<SortKey>("balance");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const { asOf } = useInsightAsOf();

  // The page belongs to one set of filters (and as-at date): when they change it falls back to 1
  // in the same render (an effect would first fetch the old page number under the new filters)
  const listKey = JSON.stringify([search, filters, sort, direction, asOf]);
  const [pageState, setPageState] = useState({ listKey, page: 1 });
  const page = pageState.listKey === listKey ? pageState.page : 1;
  const setPage = (next: number | ((current: number) => number)) =>
    setPageState({ listKey, page: typeof next === "function" ? next(page) : next });

  const query = useMemo<AccountDirectoryQuery>(() => {
    const minBalance = filters.minBalance === "" ? undefined : Number(filters.minBalance);
    return {
      search: search || undefined,
      segment: filters.segment,
      funded: filters.funded,
      channel: filters.channel || undefined,
      gender: filters.gender || undefined,
      missing: filters.missing || undefined,
      minBalance: minBalance !== undefined && Number.isFinite(minBalance) ? minBalance : undefined,
      sort,
      direction,
      page,
      pageSize: PAGE_SIZE,
    };
  }, [search, filters, sort, direction, page]);

  const { data, error, isPending, isFetching, refetch } = useQuery<DirectoryPage>({
    queryKey: ["account-profiles", query, asOf],
    queryFn: ({ signal }) => fetchAccountProfiles(query, signal, asOf),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  const totalPages = data ? Math.max(Math.ceil(data.totalAccounts / PAGE_SIZE), 1) : 1;

  // Prefetch the next page so paging forward feels instant
  useEffect(() => {
    if (!data || page >= totalPages) return;
    const next = { ...query, page: page + 1 };
    queryClient.prefetchQuery({
      queryKey: ["account-profiles", next, asOf],
      queryFn: ({ signal }) => fetchAccountProfiles(next, signal, asOf),
      staleTime: 60 * 1000,
    });
  }, [data, page, totalPages, query, queryClient, asOf]);

  const updateFilter = <K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection(key === "name" || key === "accountNumber" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, sortKey, align = "left" }: { label: string; sortKey: SortKey; align?: "left" | "right" }) => (
    <th className={`py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button onClick={() => toggleSort(sortKey)} className="inline-flex items-center gap-1 hover:text-gray-900">
        {label}
        {sort === sortKey && (direction === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );

  const firstRow = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data ? Math.min(data.page * data.pageSize, data.totalAccounts) : 0;

  return (
    <div className="p-6 space-y-4">
      {/* Filters: one row above the table */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              maxLength={100}
              placeholder="Search client name or account number"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <ToggleGroup options={SEGMENT_OPTIONS} value={filters.segment} onChange={(v) => updateFilter("segment", v)} />
          <a
            href={accountProfilesExportUrl(query, asOf)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Download className="w-4 h-4" />
            Export to Excel
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect label="Balance" value={filters.funded} options={FUNDED_OPTIONS} onChange={(v) => updateFilter("funded", v as DirectoryFilters["funded"])} />
          <FilterSelect label="Missing data" value={filters.missing} options={MISSING_OPTIONS} onChange={(v) => updateFilter("missing", v)} />
          <FilterSelect label="Sign-up channel" value={filters.channel} options={CHANNEL_OPTIONS} onChange={(v) => updateFilter("channel", v)} />
          <FilterSelect label="Declared gender" value={filters.gender} options={GENDER_OPTIONS} onChange={(v) => updateFilter("gender", v)} />
          <input
            type="number"
            min={0}
            value={filters.minBalance}
            onChange={(e) => updateFilter("minBalance", e.target.value)}
            placeholder="Min balance (UGX)"
            className="w-44 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          {(searchInput || JSON.stringify(filters) !== JSON.stringify(INITIAL_FILTERS)) && (
            <button
              onClick={() => {
                setSearchInput("");
                setFilters(INITIAL_FILTERS);
              }}
              className="text-sm text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && !data ? (
        <ErrorPanel message={(error as Error).message} onRetry={() => refetch()} />
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm text-gray-600">
              {data ? (
                <>
                  <span className="font-semibold text-gray-900">{formatCount(data.totalAccounts)}</span> accounts ·{" "}
                  {formatUGXCompact(data.totalAum)}
                </>
              ) : (
                "Loading accounts..."
              )}
              {isFetching && <Loader2 className="inline w-4 h-4 ml-2 animate-spin text-blue-600" />}
            </p>
            <p className="text-xs text-gray-500">
              Gender, age and location are as declared in Ultima. Contact details are in Ultima, not here.
            </p>
          </div>

          <div className={`overflow-x-auto transition-opacity ${isFetching ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <SortHeader label="Client" sortKey="name" />
                  <SortHeader label="Account" sortKey="accountNumber" />
                  <SortHeader label="Balance" sortKey="balance" align="right" />
                  <th className="text-left py-2 pl-4 font-medium">Gender</th>
                  <th className="text-right py-2 font-medium">Age</th>
                  <th className="text-left py-2 pl-4 font-medium">Location</th>
                  <th className="text-left py-2 font-medium">Channel</th>
                  <SortHeader label="Last deposit" sortKey="lastDeposit" />
                  <th className="text-left py-2 font-medium">Missing</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((row) => (
                  <tr
                    key={row.accountNumber}
                    onClick={() => setSelectedAccount(row.accountNumber)}
                    className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="py-2 pr-3 text-gray-900">{row.clientName}</td>
                    <td className="py-2 pr-3">
                      <div className="font-mono text-gray-900">{row.accountNumber}</div>
                      <div className="text-xs text-gray-500">{formatGroupLabel(row.accountType)}</div>
                    </td>
                    <td className="py-2 text-right text-gray-900 whitespace-nowrap">{formatUGX(row.balance)}</td>
                    <td className="py-2 pl-4 whitespace-nowrap">
                      <GenderCell gender={row.gender} />
                    </td>
                    <td className="py-2 text-right text-gray-900">{row.ageYears ?? <span className="text-gray-400">–</span>}</td>
                    <td className="py-2 pl-4 text-gray-900">{row.location ?? <span className="text-gray-400">–</span>}</td>
                    <td className="py-2 text-gray-600">{formatGroupLabel(row.signupChannel)}</td>
                    <td className="py-2 text-gray-600 whitespace-nowrap">{row.lastDepositDate ? formatDate(row.lastDepositDate) : "–"}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.missing.map((m) => (
                          <span key={m} className="px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                            {m}
                          </span>
                        ))}
                        {row.contactClosed && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700 border border-gray-200">user closed</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isPending && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            )}
            {data && data.rows.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">No accounts match these filters.</p>}
          </div>

          {data && data.totalAccounts > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-gray-600">
              <span>
                {formatCount(firstRow)}–{formatCount(lastRow)} of {formatCount(data.totalAccounts)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  className="p-2 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span>
                  Page{" "}
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={page}
                    onChange={(e) => {
                      const wanted = Number(e.target.value);
                      if (Number.isInteger(wanted) && wanted >= 1 && wanted <= totalPages) setPage(wanted);
                    }}
                    className="w-20 px-2 py-1 border border-gray-200 rounded text-center"
                  />{" "}
                  of {formatCount(totalPages)}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                  disabled={page >= totalPages}
                  className="p-2 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedAccount && <AccountProfileDetail accountNumber={selectedAccount} onClose={() => setSelectedAccount(null)} />}
    </div>
  );
};

export default AccountProfiles;
