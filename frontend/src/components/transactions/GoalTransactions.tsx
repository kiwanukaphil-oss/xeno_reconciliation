import React, { useState, useEffect } from "react";
import {
  FileText,
  Search,
  Download,
  Calendar,
  TrendingUp,
  DollarSign,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { fetchGoalTransactions, exportGoalTransactionsCSV } from "../../services/api";

interface GoalTransaction {
  goalTransactionCode: string;
  transactionDate: string;
  clientName: string;
  accountNumber: string;
  goalNumber: string;
  goalTitle: string;
  totalAmount: number;
  XUMMF: number;
  XUBF: number;
  XUDEF: number;
  XUREF: number;
  fundTransactionCount: number;
}

const GoalTransactions = () => {
  const [transactions, setTransactions] = useState<GoalTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  // Fetch goal transactions on component mount
  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      params.append("limit", "1000");

      const response = await fetchGoalTransactions(params);
      setTransactions(response.data || []);
    } catch (err) {
      console.error("Failed to fetch goal transactions:", err);
      setError((err as Error).message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);

      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (searchTerm) params.append("search", searchTerm);

      const blob = await exportGoalTransactionsCSV(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `goal_transactions_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to export transactions:", err);
      alert("Failed to export transactions");
    } finally {
      setExporting(false);
    }
  };

  const handleSearch = () => {
    fetchTransactions();
  };

  // Filter transactions by search term (client name, account number, goal number)
  const filteredTransactions = transactions.filter((t) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      t.clientName.toLowerCase().includes(term) ||
      t.accountNumber.toLowerCase().includes(term) ||
      t.goalNumber.toLowerCase().includes(term) ||
      t.goalTitle.toLowerCase().includes(term)
    );
  });

  // Calculate summary statistics
  const summary = {
    totalTransactions: filteredTransactions.length,
    totalAmount: filteredTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0),
    totalXUMMF: filteredTransactions.reduce((sum, t) => sum + (t.XUMMF || 0), 0),
    totalXUBF: filteredTransactions.reduce((sum, t) => sum + (t.XUBF || 0), 0),
    totalXUDEF: filteredTransactions.reduce((sum, t) => sum + (t.XUDEF || 0), 0),
    totalXUREF: filteredTransactions.reduce((sum, t) => sum + (t.XUREF || 0), 0),
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-UG", {
      style: "currency",
      currency: "UGX",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Goal Transactions</h2>
            <p className="text-sm text-gray-600 mt-1">
              Aggregated view of fund transactions grouped by goal
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || filteredTransactions.length === 0}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <Download className="h-5 w-5 mr-2" />
            )}
            Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by client, account, or goal..."
                className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* End Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Apply Filters Button */}
        <div className="mt-4">
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
          >
            Apply Filters
          </button>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-gray-900">
                {summary.totalTransactions}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Amount</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(summary.totalAmount)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="ml-0">
            <p className="text-sm font-medium text-gray-600">XUMMF</p>
            <p className="text-xl font-bold text-blue-600">
              {formatCurrency(summary.totalXUMMF)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="ml-0">
            <p className="text-sm font-medium text-gray-600">XUBF</p>
            <p className="text-xl font-bold text-purple-600">
              {formatCurrency(summary.totalXUBF)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="ml-0">
            <p className="text-sm font-medium text-gray-600">XUDEF</p>
            <p className="text-xl font-bold text-indigo-600">
              {formatCurrency(summary.totalXUDEF)}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="ml-0">
            <p className="text-sm font-medium text-gray-600">XUREF</p>
            <p className="text-xl font-bold text-teal-600">
              {formatCurrency(summary.totalXUREF)}
            </p>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
            <span className="ml-3 text-gray-600">Loading transactions...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <span className="ml-3 text-red-600">{error}</span>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium">No goal transactions found</p>
            <p className="text-sm mt-2">
              {transactions.length === 0
                ? "Upload a fund transaction file to see goal transactions here"
                : "No transactions match your search criteria"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Account
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Goal
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Amount
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUMMF
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUBF
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUDEF
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUREF
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTransactions.map((transaction) => (
                  <tr
                    key={transaction.goalTransactionCode}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(transaction.transactionDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.clientName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {transaction.accountNumber}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div>
                        <div className="font-medium">{transaction.goalTitle}</div>
                        <div className="text-gray-500 text-xs">
                          {transaction.goalNumber}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                      {formatCurrency(transaction.totalAmount || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-600">
                      {formatCurrency(transaction.XUMMF || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-purple-600">
                      {formatCurrency(transaction.XUBF || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-indigo-600">
                      {formatCurrency(transaction.XUDEF || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-teal-600">
                      {formatCurrency(transaction.XUREF || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer Summary */}
      {filteredTransactions.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">
              Showing {filteredTransactions.length} transaction(s)
            </span>
            <div className="flex items-center space-x-6">
              <span className="text-gray-600">
                Total: <span className="font-bold text-gray-900">{formatCurrency(summary.totalAmount)}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalTransactions;
