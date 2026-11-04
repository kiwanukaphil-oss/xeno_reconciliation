import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { fetchGroupSchemes } from "../../services/api";
import { ErrorPanel, LoadingPanel, ShareBar, StatTile } from "./InsightControls";
import { useInsightAsOf } from "./InsightAsOf";
import { formatCount, formatGroupLabel, formatPct, formatUGX, formatUGXCompact } from "./insightFormat";

interface GroupScheme {
  sponsorAccountNumber: string;
  groupName: string;
  category: string;
  sponsorInSystem: boolean;
  sponsorOwnAum: number;
  members: number;
  fundedMembers: number;
  memberAum: number;
  medianMemberBalance: number | null;
  depositorsLast12Months: number;
  femaleShareOfKnown: number | null;
}

interface GroupSchemesReport {
  summary: { groups: number; members: number; memberAum: number };
  byCategory: Array<{ category: string; groups: number; members: number; fundedMembers: number; memberAum: number }>;
  groups: GroupScheme[];
}

/**
 * Member accounts rolled up by sponsor: SACCOs, investment clubs, retirement
 * benefit schemes and family groups. Searchable by group name or sponsor account.
 */
const GroupSchemes = () => {
  const [report, setReport] = useState<GroupSchemesReport | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { asOf } = useInsightAsOf();

  useEffect(() => {
    let active = true;
    loadReport(() => active);
    // A slower, older request (e.g. a date still being prepared) must not overwrite newer figures
    return () => {
      active = false;
    };
  }, [asOf]);

  const loadReport = async (isActive: () => boolean = () => true) => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchGroupSchemes(asOf);
      if (isActive()) setReport(result);
    } catch (err: any) {
      console.error("Failed to load group schemes:", err);
      if (isActive()) setError(err.message || "Failed to load group schemes");
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!report || !term) return report?.groups ?? [];
    return report.groups.filter(
      (g) => g.groupName.toLowerCase().includes(term) || g.sponsorAccountNumber.includes(term)
    );
  }, [report, search]);

  if (loading) return <LoadingPanel />;
  if (error || !report) return <ErrorPanel message={error ?? "No data"} onRetry={() => loadReport()} />;

  const totalCategoryAum = report.byCategory.reduce((s, c) => s + Math.max(c.memberAum, 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile label="Groups" value={formatCount(report.summary.groups)} hint="Sponsors with linked member accounts in the system" />
        <StatTile label="Member accounts" value={formatCount(report.summary.members)} hint="Linked to a sponsor in Ultima" />
        <StatTile label="Member AUM" value={formatUGXCompact(report.summary.memberAum)} hint="Members' own balances" />
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">By scheme type</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="text-left py-2 font-medium">Type</th>
              <th className="text-right py-2 font-medium">Groups</th>
              <th className="text-right py-2 font-medium">Members</th>
              <th className="text-right py-2 font-medium">Funded members</th>
              <th className="text-right py-2 font-medium">Member AUM</th>
              <th className="text-left py-2 pl-6 font-medium">Share of member AUM</th>
            </tr>
          </thead>
          <tbody>
            {report.byCategory.map((c) => {
              const share = totalCategoryAum ? Math.max(c.memberAum, 0) / totalCategoryAum : 0;
              return (
                <tr key={c.category} className="border-b border-gray-100">
                  <td className="py-2 text-gray-900">{formatGroupLabel(c.category)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(c.groups)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(c.members)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(c.fundedMembers)}</td>
                  <td className="py-2 text-right text-gray-900">{formatUGXCompact(c.memberAum)}</td>
                  <td className="py-2 pl-6">
                    <div className="flex items-center gap-3">
                      <ShareBar share={share} widthClass="w-32" />
                      <span className="text-gray-900 w-12 text-right">{formatPct(share)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Groups</h2>
            <p className="text-sm text-gray-500">
              Named from the sponsor's client record where the sponsor account is in the system; otherwise shown by
              sponsor account number. Female share is of members with a declared gender.
              Gender mix and median balance are hidden for groups under 5 members.
            </p>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or sponsor account"
              className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg w-72 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200 text-gray-600">
                <th className="text-left py-2 font-medium">Group</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-right py-2 font-medium">Members</th>
                <th className="text-right py-2 font-medium">Funded</th>
                <th className="text-right py-2 font-medium">Member AUM</th>
                <th className="text-right py-2 font-medium">Median member balance</th>
                <th className="text-right py-2 font-medium">Deposited in 12m</th>
                <th className="text-right py-2 font-medium">Female (est.)</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map((g) => (
                <tr key={g.sponsorAccountNumber} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2">
                    <div className="text-gray-900">{g.groupName}</div>
                    <div className="text-xs font-mono text-gray-500">{g.sponsorAccountNumber}</div>
                  </td>
                  <td className="py-2 text-gray-600">{formatGroupLabel(g.category)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(g.members)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCount(g.fundedMembers)}</td>
                  <td className="py-2 text-right text-gray-900">{formatUGX(g.memberAum)}</td>
                  <td className="py-2 text-right text-gray-900">{formatUGX(g.medianMemberBalance)}</td>
                  <td className="py-2 text-right text-gray-900">{formatPct(g.members ? g.depositorsLast12Months / g.members : null, 0)}</td>
                  <td className="py-2 text-right text-gray-900">{formatPct(g.femaleShareOfKnown, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleGroups.length === 0 && <p className="text-sm text-gray-500 py-4">No groups match.</p>}
        </div>
      </div>
    </div>
  );
};

export default GroupSchemes;
