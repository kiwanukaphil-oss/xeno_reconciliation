import React, { useState, useEffect } from "react";
import {
  FileText,
  Search,
  Calendar,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Loader2,
  AlertCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import { fetchFundTransactions, fetchFundTransactionSummary } from "../../services/api";

interface FundTransaction {
  id: string;
  fundTransactionId: string;
  goalTransactionCode: string;
  transactionDate: string;
  clientName: string;
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  goalNumber: string;
  goalTitle: string;
  fundCode: string;
  fundName: string;
  transactionType: string;
  amount: number;
  units: number;
  bidPrice: number;
  offerPrice: number;
  midPrice: number;
  priceDate: string;
  batchNumber: string;
  reference: string | null;
  notes: string | null;
}

interface Summary {
  totalRecords: number;
  totalDeposits: number;
  totalWithdrawals: number;
  netCashFlow: number;
  byFund: {
    XUMMF: { deposits: number; withdrawals: number; net: number };
    XUBF: { deposits: number; withdrawals: number; net: number };
    XUDEF: { deposits: number; withdrawals: number; net: number };
    XUREF: { deposits: number; withdrawals: number; net: number };
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const FundTransactions = () => {
  const [transactions, setTransactions] = useState<FundTransaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState(() => {
    // Default to 30 days ago
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    // Default to today
    return new Date().toISOString().split("T")[0];
  });
  const [fundCode, setFundCode] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountCategory, setAccountCategory] = useState("");
  const [goalTransactionCode, setGoalTransactionCode] = useState("");
  const [batchId, setBatchId] = useState("");

  // Fetch transactions on component mount
  useEffect(() => {
    fetchTransactionsData();
    fetchSummaryData();
  }, []);

  const buildParams = (includePagination: boolean = true) => {
    const params = new URLSearchParams();

    // Required filters
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

    // Optional filters
    if (searchTerm) params.append("search", searchTerm);
    if (fundCode) params.append("fundCode", fundCode);
    if (transactionType) params.append("transactionType", transactionType);
    if (accountType) params.append("accountType", accountType);
    if (accountCategory) params.append("accountCategory", accountCategory);
    if (goalTransactionCode) params.append("goalTransactionCode", goalTransactionCode);
    if (batchId) params.append("batchId", batchId);

    // Pagination
    if (includePagination) {
      params.append("page", pagination.page.toString());
      params.append("limit", pagination.limit.toString());
    }

    return params;
  };

  const fetchTransactionsData = async (page: number = pagination.page) => {
    // Validate date range is provided
    if (!startDate || !endDate) {
      setError("Please provide both start and end dates");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = buildParams(true);
      params.set("page", page.toString());

      const response = await fetchFundTransactions(params);
      setTransactions(response.data || []);
      setSummary(response.summary || null);
      setPagination(response.pagination || {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
      });
    } catch (err) {
      console.error("Failed to fetch fund transactions:", err);
      setError((err as Error).message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  };

  const fetchSummaryData = async () => {
    if (!startDate || !endDate) return;

    try {
      setSummaryLoading(true);
      const params = buildParams(false);
      const data = await fetchFundTransactionSummary(params);
      setSummary(data);
    } catch (err) {
      console.error("Failed to fetch summary:", err);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSearch = () => {
    fetchTransactionsData(1); // Reset to page 1 when searching
    fetchSummaryData();
  };

  const handleReset = () => {
    setSearchTerm("");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
    setEndDate(new Date().toISOString().split("T")[0]);
    setFundCode("");
    setTransactionType("");
    setAccountType("");
    setAccountCategory("");
    setGoalTransactionCode("");
    setBatchId("");

    // Fetch with reset filters
    setTimeout(() => {
      fetchTransactionsData(1);
      fetchSummaryData();
    }, 100);
  };

  const handleNextPage = () => {
    if (pagination.page < pagination.totalPages) {
      fetchTransactionsData(pagination.page + 1);
    }
  };

  const handlePreviousPage = () => {
    if (pagination.page > 1) {
      fetchTransactionsData(pagination.page - 1);
    }
  };

  const handleGoToPage = (page: number) => {
    if (page >= 1 && page <= pagination.totalPages) {
      fetchTransactionsData(page);
    }
  };

  const handlePageInputSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('pageNumber') as HTMLInputElement;
    const pageNum = parseInt(input.value);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= pagination.totalPages) {
      fetchTransactionsData(pageNum);
      input.value = '';
    }
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const totalPages = pagination.totalPages;
    const currentPage = pagination.page;

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');

      const startPage = Math.max(2, currentPage - 1);
      const endPage = Math.min(totalPages - 1, currentPage + 1);

      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return pages;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-UG", {
      style: "currency",
      currency: "UGX",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (value: number, decimals: number = 4) => {
    return new Intl.NumberFormat("en-UG", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatName = (name: string) => {
    if (!name) return "";
    return name
      .toLowerCase()
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Fund Transactions</h2>
          <p className="text-sm text-gray-600 mt-1">
            Individual fund-level transaction audit trail (3M+ records)
          </p>
        </div>

        {/* Filters */}
        <div className="space-y-4">
          {/* Row 1: Date Range (Required) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
            </div>
          </div>

          {/* Row 2: Search and Fund Code */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by client or account..."
                  className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fund Code
              </label>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <select
                  value={fundCode}
                  onChange={(e) => setFundCode(e.target.value)}
                  className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
                >
                  <option value="">All Funds</option>
                  <option value="XUMMF">XUMMF</option>
                  <option value="XUBF">XUBF</option>
                  <option value="XUDEF">XUDEF</option>
                  <option value="XUREF">XUREF</option>
                </select>
              </div>
            </div>
          </div>

          {/* Row 3: Transaction Type and Account Type */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transaction Type
              </label>
              <select
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Types</option>
                <option value="DEPOSIT">Deposit</option>
                <option value="WITHDRAWAL">Withdrawal</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Account Type
              </label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Types</option>
                <option value="PERSONAL">Personal</option>
                <option value="POOLED">Pooled</option>
                <option value="JOINT">Joint</option>
                <option value="LINKED">Linked</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Account Category
              </label>
              <select
                value={accountCategory}
                onChange={(e) => setAccountCategory(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Categories</option>
                <option value="GENERAL">General</option>
                <option value="FAMILY">Family</option>
                <option value="INVESTMENT_CLUBS">Investment Clubs</option>
                <option value="RETIREMENTS_BENEFIT_SCHEME">Retirements Benefit Scheme</option>
              </select>
            </div>
          </div>

          {/* Row 4: Advanced Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Goal Transaction Code
              </label>
              <input
                type="text"
                value={goalTransactionCode}
                onChange={(e) => setGoalTransactionCode(e.target.value)}
                placeholder="e.g., 2025-08-01-701-5558635193a"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Batch ID
              </label>
              <input
                type="text"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="Filter by upload batch"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Filter Action Buttons */}
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleSearch}
            disabled={!startDate || !endDate}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
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

        {!startDate || !endDate ? (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              Date range is required to prevent timeouts on large datasets (3M+ records)
            </p>
          </div>
        ) : null}
      </div>

      {/* Summary Statistics */}
      {summary && !summaryLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Records */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Records</p>
                <p className="text-2xl font-bold text-gray-900">
                  {summary.totalRecords.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Total Deposits */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Deposits</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(summary.totalDeposits)}
                </p>
              </div>
            </div>
          </div>

          {/* Total Withdrawals */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded-lg">
                <TrendingDown className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Withdrawals</p>
                <p className="text-xl font-bold text-red-600">
                  {formatCurrency(summary.totalWithdrawals)}
                </p>
              </div>
            </div>
          </div>

          {/* Net Cash Flow */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${summary.netCashFlow >= 0 ? 'bg-blue-100' : 'bg-orange-100'}`}>
                <DollarSign className={`h-6 w-6 ${summary.netCashFlow >= 0 ? 'text-blue-600' : 'text-orange-600'}`} />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Net Cash Flow</p>
                <p className={`text-xl font-bold ${summary.netCashFlow >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  {formatCurrency(summary.netCashFlow)}
                </p>
              </div>
            </div>
          </div>

          {/* Fund Breakdown - XUMMF */}
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">XUMMF</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Deposits:</span>
                <span className="text-green-600 font-medium">{formatCurrency(summary.byFund.XUMMF.deposits)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Withdrawals:</span>
                <span className="text-red-600 font-medium">{formatCurrency(summary.byFund.XUMMF.withdrawals)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t">
                <span className="font-medium">Net:</span>
                <span className={`font-bold ${summary.byFund.XUMMF.net >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  {formatCurrency(summary.byFund.XUMMF.net)}
                </span>
              </div>
            </div>
          </div>

          {/* Fund Breakdown - XUBF */}
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">XUBF</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Deposits:</span>
                <span className="text-green-600 font-medium">{formatCurrency(summary.byFund.XUBF.deposits)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Withdrawals:</span>
                <span className="text-red-600 font-medium">{formatCurrency(summary.byFund.XUBF.withdrawals)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t">
                <span className="font-medium">Net:</span>
                <span className={`font-bold ${summary.byFund.XUBF.net >= 0 ? 'text-purple-600' : 'text-orange-600'}`}>
                  {formatCurrency(summary.byFund.XUBF.net)}
                </span>
              </div>
            </div>
          </div>

          {/* Fund Breakdown - XUDEF */}
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">XUDEF</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Deposits:</span>
                <span className="text-green-600 font-medium">{formatCurrency(summary.byFund.XUDEF.deposits)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Withdrawals:</span>
                <span className="text-red-600 font-medium">{formatCurrency(summary.byFund.XUDEF.withdrawals)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t">
                <span className="font-medium">Net:</span>
                <span className={`font-bold ${summary.byFund.XUDEF.net >= 0 ? 'text-indigo-600' : 'text-orange-600'}`}>
                  {formatCurrency(summary.byFund.XUDEF.net)}
                </span>
              </div>
            </div>
          </div>

          {/* Fund Breakdown - XUREF */}
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm font-medium text-gray-600 mb-2">XUREF</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Deposits:</span>
                <span className="text-green-600 font-medium">{formatCurrency(summary.byFund.XUREF.deposits)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Withdrawals:</span>
                <span className="text-red-600 font-medium">{formatCurrency(summary.byFund.XUREF.withdrawals)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t">
                <span className="font-medium">Net:</span>
                <span className={`font-bold ${summary.byFund.XUREF.net >= 0 ? 'text-teal-600' : 'text-orange-600'}`}>
                  {formatCurrency(summary.byFund.XUREF.net)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <p className="text-lg font-medium">No fund transactions found</p>
            <p className="text-sm mt-2">
              {!startDate || !endDate
                ? "Please select a date range to view transactions"
                : "Try adjusting your filters or date range"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Account
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Goal
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fund
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Units
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Batch
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(transaction.transactionDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatName(transaction.clientName)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      <div>
                        <div>{transaction.accountNumber}</div>
                        <div className="text-xs text-gray-500">{transaction.accountType}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div>
                        <div className="font-medium">{transaction.goalTitle}</div>
                        <div className="text-xs text-gray-500">{transaction.goalNumber}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        transaction.fundCode === 'XUMMF' ? 'bg-blue-100 text-blue-800' :
                        transaction.fundCode === 'XUBF' ? 'bg-purple-100 text-purple-800' :
                        transaction.fundCode === 'XUDEF' ? 'bg-indigo-100 text-indigo-800' :
                        'bg-teal-100 text-teal-800'
                      }`}>
                        {transaction.fundCode}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        transaction.transactionType === 'DEPOSIT'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {transaction.transactionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                      {formatCurrency(transaction.amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">
                      {formatNumber(transaction.units, 4)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">
                      <div className="text-xs">
                        <div>Offer: {formatNumber(transaction.offerPrice, 2)}</div>
                        <div className="text-gray-500">Mid: {formatNumber(transaction.midPrice, 2)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {transaction.batchNumber}
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
              <span className="ml-2">({transactions.length} of {pagination.total.toLocaleString()} transactions)</span>
            </div>

            {/* Pagination buttons */}
            <div className="flex items-center justify-center gap-1 flex-wrap">
              <button
                onClick={handlePreviousPage}
                disabled={pagination.page === 1}
                className="inline-flex items-center px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

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
      {transactions.length > 0 && summary && (
        <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
          <div className="text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-700">
                Total across all pages: {pagination.total.toLocaleString()} transaction(s)
              </span>
              <div className="flex items-center space-x-6">
                <span className="text-gray-600">
                  Net Cash Flow: <span className={`font-bold ${summary.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(summary.netCashFlow)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FundTransactions;
