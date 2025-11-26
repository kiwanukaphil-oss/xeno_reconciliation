import { useState, useEffect } from "react";
import { TrendingUp, DollarSign, Users, Calendar, Loader2 } from "lucide-react";
import { fetchDashboardMetrics } from "../services/api";

interface CategoryAUM {
  category: string;
  aum: number;
  accountCount: number;
  percentage: number;
}

interface MonthlyTransaction {
  month: string;
  amount: number;
  transactionCount: number;
}

interface DashboardMetrics {
  lastUploadDate: string | null;
  totalAUM: number;
  totalFundedAccounts: number;
  aumByCategory: CategoryAUM[];
  depositsByMonth: MonthlyTransaction[];
  withdrawalsByMonth: MonthlyTransaction[];
  asOfDate: string;
  prices: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
}

const Dashboard = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDashboardMetrics();
      setMetrics(data);
    } catch (err: any) {
      console.error("Failed to load dashboard metrics:", err);
      setError(err.message || "Failed to load dashboard metrics");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-UG", {
      style: "currency",
      currency: "UGX",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-UG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatMonth = (month: string) => {
    const [year, monthNum] = month.split("-");
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    return date.toLocaleDateString("en-UG", {
      year: "numeric",
      month: "short",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={loadMetrics}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          As of {formatDate(metrics.asOfDate)}
        </p>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total AUM</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(metrics.totalAUM)}
              </p>
            </div>
            <DollarSign className="h-12 w-12 text-green-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Across all fund categories
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Funded Accounts</p>
              <p className="text-2xl font-bold text-gray-900">
                {metrics.totalFundedAccounts.toLocaleString()}
              </p>
            </div>
            <Users className="h-12 w-12 text-blue-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Accounts with balance ≥ UGX 5,000
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Last Upload</p>
              <p className="text-lg font-bold text-gray-900">
                {formatDate(metrics.lastUploadDate)}
              </p>
            </div>
            <Calendar className="h-12 w-12 text-purple-600 opacity-20" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Most recent transaction upload
          </p>
        </div>
      </div>

      {/* AUM by Category */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <TrendingUp className="w-5 h-5 mr-2" />
          AUM by Category
        </h2>
        <div className="space-y-4">
          {metrics.aumByCategory.map((category) => (
            <div key={category.category}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-4">
                  <span className="font-medium text-gray-900 min-w-[200px]">
                    {category.category}
                  </span>
                  <span className="text-sm text-gray-600">
                    {category.accountCount.toLocaleString()} accounts
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(category.aum)}
                  </span>
                  <span className="text-sm text-gray-600 ml-2">
                    ({category.percentage.toFixed(1)}%)
                  </span>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${category.percentage}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly Transactions - Combined View */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Monthly Transactions (Last 12 Months)
        </h2>
        {metrics.depositsByMonth.length === 0 && metrics.withdrawalsByMonth.length === 0 ? (
          <p className="text-gray-500 text-sm">No transaction data available</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="text-left py-3 px-2 font-semibold text-gray-700">Month</th>
                  <th className="text-right py-3 px-2 font-semibold text-gray-700">Deposits</th>
                  <th className="text-center py-3 px-2 font-semibold text-gray-500 text-xs">Txns</th>
                  <th className="text-right py-3 px-2 font-semibold text-gray-700">Withdrawals</th>
                  <th className="text-center py-3 px-2 font-semibold text-gray-500 text-xs">Txns</th>
                  <th className="text-right py-3 px-2 font-semibold text-gray-700">Net Deposits</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Merge deposits and withdrawals by month
                  const monthsMap = new Map<string, { deposits: number; depositsCount: number; withdrawals: number; withdrawalsCount: number }>();

                  metrics.depositsByMonth.forEach((d) => {
                    monthsMap.set(d.month, {
                      deposits: d.amount,
                      depositsCount: d.transactionCount,
                      withdrawals: 0,
                      withdrawalsCount: 0,
                    });
                  });

                  metrics.withdrawalsByMonth.forEach((w) => {
                    const existing = monthsMap.get(w.month);
                    if (existing) {
                      existing.withdrawals = w.amount;
                      existing.withdrawalsCount = w.transactionCount;
                    } else {
                      monthsMap.set(w.month, {
                        deposits: 0,
                        depositsCount: 0,
                        withdrawals: w.amount,
                        withdrawalsCount: w.transactionCount,
                      });
                    }
                  });

                  // Sort by month descending
                  const sortedMonths = Array.from(monthsMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

                  // Calculate totals
                  const totalDeposits = sortedMonths.reduce((sum, [_, data]) => sum + data.deposits, 0);
                  const totalWithdrawals = sortedMonths.reduce((sum, [_, data]) => sum + data.withdrawals, 0);
                  const totalNet = totalDeposits - totalWithdrawals;
                  const totalDepositsCount = sortedMonths.reduce((sum, [_, data]) => sum + data.depositsCount, 0);
                  const totalWithdrawalsCount = sortedMonths.reduce((sum, [_, data]) => sum + data.withdrawalsCount, 0);

                  return (
                    <>
                      {sortedMonths.map(([month, data]) => {
                        const netDeposits = data.deposits - data.withdrawals;
                        return (
                          <tr key={month} className="border-b border-gray-200 hover:bg-gray-50">
                            <td className="py-3 px-2 font-medium text-gray-900">{formatMonth(month)}</td>
                            <td className="py-3 px-2 text-right font-semibold text-green-600">
                              {formatCurrency(data.deposits)}
                            </td>
                            <td className="py-3 px-2 text-center text-xs text-gray-500">
                              {data.depositsCount.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-semibold text-red-600">
                              {formatCurrency(data.withdrawals)}
                            </td>
                            <td className="py-3 px-2 text-center text-xs text-gray-500">
                              {data.withdrawalsCount.toLocaleString()}
                            </td>
                            <td className={`py-3 px-2 text-right font-bold ${netDeposits >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                              {formatCurrency(netDeposits)}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Total Row */}
                      <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                        <td className="py-3 px-2 text-gray-900">Total</td>
                        <td className="py-3 px-2 text-right text-green-700">
                          {formatCurrency(totalDeposits)}
                        </td>
                        <td className="py-3 px-2 text-center text-xs text-gray-600">
                          {totalDepositsCount.toLocaleString()}
                        </td>
                        <td className="py-3 px-2 text-right text-red-700">
                          {formatCurrency(totalWithdrawals)}
                        </td>
                        <td className="py-3 px-2 text-center text-xs text-gray-600">
                          {totalWithdrawalsCount.toLocaleString()}
                        </td>
                        <td className={`py-3 px-2 text-right ${totalNet >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                          {formatCurrency(totalNet)}
                        </td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fund Prices */}
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Current Fund Prices (Mid Price)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">XUMMF</p>
            <p className="text-xl font-bold text-blue-900">
              {metrics.prices.XUMMF.toLocaleString("en-UG", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">XUBF</p>
            <p className="text-xl font-bold text-green-900">
              {metrics.prices.XUBF.toLocaleString("en-UG", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">XUDEF</p>
            <p className="text-xl font-bold text-purple-900">
              {metrics.prices.XUDEF.toLocaleString("en-UG", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">XUREF</p>
            <p className="text-xl font-bold text-orange-900">
              {metrics.prices.XUREF.toLocaleString("en-UG", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
