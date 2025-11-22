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
  RotateCcw,
  ChevronLeft,
  ChevronRight,
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

interface Aggregates {
  totalCount: number;
  totalAmount: number;
  totalXUMMF: number;
  totalXUBF: number;
  totalXUDEF: number;
  totalXUREF: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const GoalTransactions = () => {
  const [transactions, setTransactions] = useState<GoalTransaction[]>([]);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
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

  const fetchTransactions = async (page: number = pagination.page) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (searchTerm) params.append("search", searchTerm);
      params.append("page", page.toString());
      params.append("limit", pagination.limit.toString());

      const response = await fetchGoalTransactions(params);
      setTransactions(response.data || []);
      setAggregates(response.aggregates || null);
      setPagination(response.pagination || {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
      });
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
    fetchTransactions(1); // Reset to page 1 when searching
  };

  const handleReset = () => {
    setSearchTerm("");
    setStartDate("");
    setEndDate("");
    fetchTransactions(1); // Reset to page 1 when resetting
  };

  const handleNextPage = () => {
    if (pagination.page < pagination.totalPages) {
      fetchTransactions(pagination.page + 1);
    }
  };

  const handlePreviousPage = () => {
    if (pagination.page > 1) {
      fetchTransactions(pagination.page - 1);
    }
  };

  const handleGoToPage = (page: number) => {
    if (page >= 1 && page <= pagination.totalPages) {
      fetchTransactions(page);
    }
  };

  const handlePageInputSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('pageNumber') as HTMLInputElement;
    const pageNum = parseInt(input.value);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= pagination.totalPages) {
      fetchTransactions(pageNum);
      input.value = '';
    }
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const totalPages = pagination.totalPages;
    const currentPage = pagination.page;

    if (totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      // Show pages around current page
      const startPage = Math.max(2, currentPage - 1);
      const endPage = Math.min(totalPages - 1, currentPage + 1);

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  // Note: Search is now handled server-side via the API
  // No client-side filtering needed

  // Use server-side aggregates for summary statistics (reflects ALL filtered data, not just current page)
  const summary = aggregates || {
    totalCount: 0,
    totalAmount: 0,
    totalXUMMF: 0,
    totalXUBF: 0,
    totalXUDEF: 0,
    totalXUREF: 0,
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
            disabled={exporting || transactions.length === 0}
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

        {/* Filter Action Buttons */}
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
          >
            Apply Filters
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Filters
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
                {summary.totalCount}
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
        ) : transactions.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium">No goal transactions found</p>
            <p className="text-sm mt-2">
              Upload a fund transaction file to see goal transactions here
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
                {transactions.map((transaction) => (
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

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex flex-col gap-4">
            {/* Page info */}
            <div className="text-sm text-gray-600 text-center">
              Showing page {pagination.page} of {pagination.totalPages}
              <span className="ml-2">({transactions.length} of {pagination.total} transactions)</span>
            </div>

            {/* Pagination buttons */}
            <div className="flex items-center justify-center gap-1 flex-wrap">
              {/* Previous button */}
              <button
                onClick={handlePreviousPage}
                disabled={pagination.page === 1}
                className="inline-flex items-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {/* Page number buttons */}
              {getPageNumbers().map((pageNum, index) => (
                pageNum === '...' ? (
                  <span key={`ellipsis-${index}`} className="px-3 py-2 text-gray-500">
                    ...
                  </span>
                ) : (
                  <button
                    key={`page-${pageNum}`}
                    onClick={() => handleGoToPage(pageNum as number)}
                    className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                      pagination.page === pageNum
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              ))}

              {/* Next button */}
              <button
                onClick={handleNextPage}
                disabled={pagination.page === pagination.totalPages}
                className="inline-flex items-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Go to page input */}
            {pagination.totalPages > 7 && (
              <div className="flex items-center justify-center gap-2">
                <form onSubmit={handlePageInputSubmit} className="flex items-center gap-2">
                  <label htmlFor="pageNumber" className="text-sm text-gray-600">
                    Go to page:
                  </label>
                  <input
                    type="number"
                    id="pageNumber"
                    name="pageNumber"
                    min="1"
                    max={pagination.totalPages}
                    placeholder={`1-${pagination.totalPages}`}
                    className="w-20 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Go
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer Summary */}
      {transactions.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">
              Total across all pages: {pagination.total} transaction(s)
            </span>
            <div className="flex items-center space-x-6">
              <span className="text-gray-600">
                Total Amount: <span className="font-bold text-gray-900">{formatCurrency(summary.totalAmount)}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalTransactions;
