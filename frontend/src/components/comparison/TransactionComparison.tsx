import React, { useState, useEffect } from "react";
import {
  Scale,
  Search,
  Calendar,
  Download,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import {
  fetchTransactionComparison,
  exportTransactionComparisonCSV,
} from "../../services/api";

interface ComparisonRow {
  matchKey: string;
  matchStatus: "MATCHED" | "VARIANCE_DETECTED" | "MISSING_IN_FUND" | "MISSING_IN_BANK";
  bankTransactionCount: number; // Number of bank rows aggregated (>1 means multiple transactions with same transactionId)
  bank: {
    ids: string[];
    transactionDate: string;
    clientName: string;
    accountNumber: string;
    goalNumber: string;
    goalTitle: string;
    transactionId: string;
    totalAmount: number;
    xummfAmount: number;
    xubfAmount: number;
    xudefAmount: number;
    xurefAmount: number;
    reconciliationStatus: string;
  };
  fund: {
    goalTransactionCode: string;
    transactionDate: string;
    clientName: string;
    totalAmount: number;
    xummfAmount: number;
    xubfAmount: number;
    xudefAmount: number;
    xurefAmount: number;
    fundCount: number;
  } | null;
  variance: {
    totalDiff: number;
    xummfDiff: number;
    xubfDiff: number;
    xudefDiff: number;
    xurefDiff: number;
    hasVariance: boolean;
  };
}

interface Aggregates {
  bankTotal: number;
  fundTotal: number;
  varianceAmount: number;
  matchedCount: number;
  varianceCount: number;
  missingInFundCount: number;
  matchRate: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const TransactionComparison = () => {
  const [data, setData] = useState<ComparisonRow[]>([]);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filter state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goalNumber, setGoalNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [matchStatus, setMatchStatus] = useState("ALL");

  // Expanded rows state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTransactionComparison({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        accountNumber: accountNumber || undefined,
        clientSearch: clientSearch || undefined,
        matchStatus: matchStatus !== "ALL" ? matchStatus : undefined,
        page,
        limit: pagination.limit,
      });
      setData(result.data);
      setAggregates(result.aggregates);
      setPagination(result.pagination);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = () => {
    fetchData(1);
  };

  const handleResetFilters = () => {
    setStartDate("");
    setEndDate("");
    setGoalNumber("");
    setAccountNumber("");
    setClientSearch("");
    setMatchStatus("ALL");
    // Fetch with reset filters
    setTimeout(() => fetchData(1), 0);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportTransactionComparisonCSV({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        accountNumber: accountNumber || undefined,
        clientSearch: clientSearch || undefined,
        matchStatus: matchStatus !== "ALL" ? matchStatus : undefined,
      });
    } catch (err) {
      alert("Failed to export: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      fetchData(newPage);
    }
  };

  const toggleRowExpand = (matchKey: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(matchKey)) {
      newExpanded.delete(matchKey);
    } else {
      newExpanded.add(matchKey);
    }
    setExpandedRows(newExpanded);
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString("en-US");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getMatchStatusIcon = (status: string) => {
    switch (status) {
      case "MATCHED":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "VARIANCE_DETECTED":
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case "MISSING_IN_FUND":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "MISSING_IN_BANK":
        return <XCircle className="h-5 w-5 text-purple-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getMatchStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      MATCHED: "bg-green-100 text-green-800",
      VARIANCE_DETECTED: "bg-orange-100 text-orange-800",
      MISSING_IN_FUND: "bg-red-100 text-red-800",
      MISSING_IN_BANK: "bg-purple-100 text-purple-800",
    };
    return badges[status] || "bg-gray-100 text-gray-800";
  };

  const getVarianceClass = (diff: number) => {
    if (diff === 0) return "text-gray-500";
    return diff > 0 ? "text-red-600" : "text-green-600";
  };

  const getRowBgClass = (status: string) => {
    switch (status) {
      case "MATCHED":
        return "bg-green-50 hover:bg-green-100";
      case "VARIANCE_DETECTED":
        return "bg-orange-50 hover:bg-orange-100";
      case "MISSING_IN_FUND":
        return "bg-red-50 hover:bg-red-100";
      default:
        return "hover:bg-gray-50";
    }
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Scale className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Transaction Comparison</h1>
        </div>
        <p className="text-gray-600">
          Compare bank transactions with fund transactions to investigate reconciliation variances
        </p>
      </div>

      {/* Summary Cards */}
      {aggregates && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Bank Total</p>
            <p className="text-2xl font-bold text-blue-600">
              {formatCurrency(aggregates.bankTotal)}
            </p>
          </div>
          <div className="bg-white border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Fund Total</p>
            <p className="text-2xl font-bold text-purple-600">
              {formatCurrency(aggregates.fundTotal)}
            </p>
          </div>
          <div className="bg-white border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Variance Amount</p>
            <p className="text-2xl font-bold text-orange-600">
              {formatCurrency(aggregates.varianceAmount)}
            </p>
          </div>
          <div className="bg-white border border-green-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Match Rate</p>
            <p className="text-2xl font-bold text-green-600">
              {aggregates.matchRate.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {aggregates.matchedCount} matched, {aggregates.varianceCount} variance, {aggregates.missingInFundCount} missing
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* End Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Goal Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Goal Number
            </label>
            <input
              type="text"
              value={goalNumber}
              onChange={(e) => setGoalNumber(e.target.value)}
              placeholder="e.g., 701-123..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Account Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Account Number
            </label>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g., 701-..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Client Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client Name
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search client..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Match Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Match Status
            </label>
            <select
              value={matchStatus}
              onChange={(e) => setMatchStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              <option value="MATCHED">Matched</option>
              <option value="VARIANCE_DETECTED">Variance Detected</option>
              <option value="MISSING_IN_FUND">Missing in Fund</option>
            </select>
          </div>
        </div>

        {/* Filter Actions */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleApplyFilters}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Apply Filters
          </button>
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || data.length === 0}
            className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 ml-auto"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export CSV
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Comparison Table */}
      {!loading && data.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10"></th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-24">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Goal Number</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Txn ID</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bank Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Fund Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.map((row) => (
                  <React.Fragment key={row.matchKey}>
                    <tr
                      className={`${getRowBgClass(row.matchStatus)} cursor-pointer transition-colors`}
                      onClick={() => toggleRowExpand(row.matchKey)}
                    >
                      <td className="px-3 py-3 text-center">
                        {expandedRows.has(row.matchKey) ? (
                          <ChevronUp className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-2">
                          {getMatchStatusIcon(row.matchStatus)}
                          <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${getMatchStatusBadge(row.matchStatus)}`}>
                            {row.matchStatus.replace(/_/g, " ")}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatDate(row.bank.transactionDate)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {row.bank.clientName}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {row.bank.goalNumber}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">
                        {row.bank.transactionId}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-blue-600">
                        <div className="flex items-center justify-end gap-1">
                          {formatCurrency(row.bank.totalAmount)}
                          {row.bankTransactionCount > 1 && (
                            <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded" title={`Sum of ${row.bankTransactionCount} bank transactions`}>
                              x{row.bankTransactionCount}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-purple-600">
                        {row.fund ? formatCurrency(row.fund.totalAmount) : "-"}
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${getVarianceClass(row.variance.totalDiff)}`}>
                        {row.variance.totalDiff !== 0 ? (
                          <>
                            {row.variance.totalDiff > 0 ? "+" : ""}
                            {formatCurrency(row.variance.totalDiff)}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                    {/* Expanded Row - Fund Breakdown */}
                    {expandedRows.has(row.matchKey) && (
                      <tr className="bg-gray-50">
                        <td colSpan={9} className="px-4 py-4">
                          <div className="grid grid-cols-4 gap-4">
                            {/* XUMMF */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <p className="text-xs font-medium text-blue-800 mb-2">XUMMF</p>
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                  <p className="text-gray-500 text-xs">Bank</p>
                                  <p className="font-medium">{formatCurrency(row.bank.xummfAmount)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Fund</p>
                                  <p className="font-medium">{row.fund ? formatCurrency(row.fund.xummfAmount) : "-"}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Diff</p>
                                  <p className={`font-bold ${getVarianceClass(row.variance.xummfDiff)}`}>
                                    {row.variance.xummfDiff !== 0 ? formatCurrency(row.variance.xummfDiff) : "-"}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {/* XUBF */}
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                              <p className="text-xs font-medium text-purple-800 mb-2">XUBF</p>
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                  <p className="text-gray-500 text-xs">Bank</p>
                                  <p className="font-medium">{formatCurrency(row.bank.xubfAmount)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Fund</p>
                                  <p className="font-medium">{row.fund ? formatCurrency(row.fund.xubfAmount) : "-"}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Diff</p>
                                  <p className={`font-bold ${getVarianceClass(row.variance.xubfDiff)}`}>
                                    {row.variance.xubfDiff !== 0 ? formatCurrency(row.variance.xubfDiff) : "-"}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {/* XUDEF */}
                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                              <p className="text-xs font-medium text-indigo-800 mb-2">XUDEF</p>
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                  <p className="text-gray-500 text-xs">Bank</p>
                                  <p className="font-medium">{formatCurrency(row.bank.xudefAmount)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Fund</p>
                                  <p className="font-medium">{row.fund ? formatCurrency(row.fund.xudefAmount) : "-"}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Diff</p>
                                  <p className={`font-bold ${getVarianceClass(row.variance.xudefDiff)}`}>
                                    {row.variance.xudefDiff !== 0 ? formatCurrency(row.variance.xudefDiff) : "-"}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {/* XUREF */}
                            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
                              <p className="text-xs font-medium text-teal-800 mb-2">XUREF</p>
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                  <p className="text-gray-500 text-xs">Bank</p>
                                  <p className="font-medium">{formatCurrency(row.bank.xurefAmount)}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Fund</p>
                                  <p className="font-medium">{row.fund ? formatCurrency(row.fund.xurefAmount) : "-"}</p>
                                </div>
                                <div>
                                  <p className="text-gray-500 text-xs">Diff</p>
                                  <p className={`font-bold ${getVarianceClass(row.variance.xurefDiff)}`}>
                                    {row.variance.xurefDiff !== 0 ? formatCurrency(row.variance.xurefDiff) : "-"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 mt-3 space-y-1">
                            {row.bankTransactionCount > 1 && (
                              <p className="text-blue-700">
                                <strong>Note:</strong> Bank amount is aggregated from {row.bankTransactionCount} separate bank transactions with the same transaction ID
                              </p>
                            )}
                            {row.fund && (
                              <p>
                                Goal Transaction Code: <span className="font-mono">{row.fund.goalTransactionCode}</span>
                                {" • "}
                                {row.fund.fundCount} fund transaction(s)
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-700">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total.toLocaleString()} results
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1 || loading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </button>
              <span className="text-sm text-gray-700 px-3">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages || loading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && data.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Scale className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No comparison data found</p>
          <p className="text-gray-500 text-sm mt-2">
            Try adjusting your filters or upload bank transactions first
          </p>
        </div>
      )}

      {/* Tolerance Info */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-medium mb-1">Matching Criteria:</p>
        <p>
          Transactions are matched by <strong>Goal Number + Transaction ID</strong>.
          Amounts are considered matched if the difference is within <strong>1% or UGX 1,000</strong> (whichever is greater).
        </p>
        <p className="mt-2">
          <strong>Multiple transactions with same ID:</strong> When multiple bank transactions share the same transaction ID
          (e.g., 2 withdrawals on the same day), they are automatically aggregated and compared to the total fund amount.
          The <span className="bg-blue-100 px-1 rounded">x2</span> badge indicates aggregated rows.
        </p>
      </div>
    </div>
  );
};

export default TransactionComparison;
