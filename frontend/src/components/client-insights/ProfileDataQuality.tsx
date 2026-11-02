import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { fetchProfileDataQuality } from "../../services/api";
import { formatCount, formatPct, formatUGX, formatUGXCompact } from "./insightFormat";

interface DataQualityReport {
  fundedAccounts: number;
  aum: number;
  completeness: Array<{ field: string; knownAccounts: number; knownShareOfAccounts: number; knownShareOfAum: number }>;
  flags: Array<{ flag: string; accounts: number; aum: number }>;
  largestAccountsMissingData: Array<{ accountNumber: string; accountType: string; aum: number; missing: string[] }>;
  unmatchedDistricts: Array<{ value: string; accounts: number }>;
}

/** Thin same-hue meter: known share against a full-width track. */
const KnownMeter = ({ share }: { share: number }) => (
  <div className="flex items-center gap-3">
    <div className="w-32 bg-gray-100 rounded-full h-2">
      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${share * 100}%` }} />
    </div>
    <span className="text-sm text-gray-900 w-14 text-right">{formatPct(share)}</span>
  </div>
);

/**
 * Where client profile data is missing or doubtful, ranked by AUM affected:
 * completeness per field, operational flags, the largest individual accounts
 * missing data (KYC follow-up list) and district text the lookup could not match.
 */
const ProfileDataQuality = () => {
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReport();
  }, []);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      setReport(await fetchProfileDataQuality("INDIVIDUAL", 50));
    } catch (err: any) {
      console.error("Failed to load profile data quality:", err);
      setError(err.message || "Failed to load profile data quality");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={loadReport} className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <p className="text-sm text-gray-600">
        Individual funded accounts: {formatCount(report.fundedAccounts)} holding {formatUGXCompact(report.aum)}.
        Profile data comes from Ultima exports; re-run the profile import after each new export.
      </p>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile completeness</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="text-left py-2 font-medium">Field</th>
              <th className="text-right py-2 font-medium">Accounts known</th>
              <th className="text-left py-2 pl-6 font-medium">Share of accounts</th>
              <th className="text-left py-2 pl-6 font-medium">Share of AUM</th>
            </tr>
          </thead>
          <tbody>
            {report.completeness.map((row) => (
              <tr key={row.field} className="border-b border-gray-100">
                <td className="py-2 text-gray-900">{row.field}</td>
                <td className="py-2 text-right text-gray-900">{formatCount(row.knownAccounts)}</td>
                <td className="py-2 pl-6"><KnownMeter share={row.knownShareOfAccounts} /></td>
                <td className="py-2 pl-6"><KnownMeter share={row.knownShareOfAum} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {report.flags.map((flag) => (
          <div key={flag.flag} className="bg-white p-5 rounded-lg shadow">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>{flag.flag}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCount(flag.accounts)}</p>
            <p className="text-xs text-gray-500 mt-1">funded accounts holding {formatUGXCompact(flag.aum)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Largest accounts missing profile data</h2>
          <p className="text-sm text-gray-500 mb-4">KYC follow-up list, ranked by balance.</p>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="text-left py-2 font-medium">Account</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-right py-2 font-medium">Balance</th>
                  <th className="text-left py-2 pl-6 font-medium">Missing</th>
                </tr>
              </thead>
              <tbody>
                {report.largestAccountsMissingData.map((row) => (
                  <tr key={row.accountNumber} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 font-mono text-gray-900">{row.accountNumber}</td>
                    <td className="py-2 text-gray-600">{row.accountType}</td>
                    <td className="py-2 text-right text-gray-900">{formatUGX(row.aum)}</td>
                    <td className="py-2 pl-6 text-gray-600">{row.missing.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Unmatched district entries</h2>
          <p className="text-sm text-gray-500 mb-4">
            Text that could not be mapped to a district or country. Add common ones to the lookup lists.
          </p>
          <ul className="text-sm divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
            {report.unmatchedDistricts.map((d) => (
              <li key={d.value} className="flex justify-between py-1.5">
                <span className="text-gray-900">{d.value}</span>
                <span className="text-gray-500">{formatCount(d.accounts)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ProfileDataQuality;
