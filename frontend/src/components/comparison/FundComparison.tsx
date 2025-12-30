import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart3,
  Search,
  Calendar,
  Download,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  RefreshCw,
  Target,
  Briefcase,
} from "lucide-react";
import {
  fetchFundComparison,
  exportFundComparisonCSV,
  fetchGoalTransactionsWithMatching,
  fetchAccountFundComparison,
} from "../../services/api";
import type {
  FundComparisonRow,
  FundComparisonAggregates,
  AccountFundComparisonRow,
  AccountFundComparisonAggregates,
} from "../../services/api";

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface MatchInfo {
  matchType: "EXACT" | "AMOUNT" | "SPLIT_BANK_TO_FUND" | "SPLIT_FUND_TO_BANK";
  matchedGoalTxnIds?: string[];
  matchedBankIds?: string[];
  confidence: number;
  bankTotal?: number;
  goalTxnTotal?: number;
}

interface GoalTransactionWithMatch {
  goalTransactionCode: string;
  transactionDate: string;
  transactionId: string | null;
  transactionType: string;
  totalAmount: number;
  xummfAmount: number;
  xubfAmount: number;
  xudefAmount: number;
  xurefAmount: number;
  fundTransactionIds: string[];
  matchInfo: MatchInfo | null;
  isMatched: boolean;
}

interface BankTransactionWithMatch {
  id: string;
  transactionDate: string;
  transactionId: string;
  transactionType: string;
  totalAmount: number;
  xummfAmount: number;
  xubfAmount: number;
  xudefAmount: number;
  xurefAmount: number;
  matchInfo: MatchInfo | null;
  isMatched: boolean;
}

interface TransactionDrilldown {
  bankTransactions: BankTransactionWithMatch[];
  goalTransactions: GoalTransactionWithMatch[];
  summary: {
    bankCount: number;
    goalTxnCount: number;
    matchedBankCount: number;
    matchedGoalTxnCount: number;
    unmatchedBankCount: number;
    unmatchedGoalTxnCount: number;
    exactMatches: number;
    amountMatches: number;
    splitMatches: number;
  };
}

type SortField = 'xummfVariance' | 'xubfVariance' | 'xudefVariance' | 'xurefVariance' | 'totalVariance' | 'goalNumber';
type AccountSortField = 'xummfVariance' | 'xubfVariance' | 'xudefVariance' | 'xurefVariance' | 'totalVariance' | 'accountNumber' | 'goalCount';

const FundComparison = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState<'goal' | 'account'>('goal');

  // Goal tab data state
  const [data, setData] = useState<FundComparisonRow[]>([]);
  const [aggregates, setAggregates] = useState<FundComparisonAggregates | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  // Account tab data state
  const [accountData, setAccountData] = useState<AccountFundComparisonRow[]>([]);
  const [accountAggregates, setAccountAggregates] = useState<AccountFundComparisonAggregates | null>(null);
  const [accountPagination, setAccountPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  // Loading/Error state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filter state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goalNumber, setGoalNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  // Sorting state - Goal tab
  const [sortField, setSortField] = useState<SortField>('totalVariance');
  const [sortAscending, setSortAscending] = useState(false);

  // Sorting state - Account tab
  const [accountSortField, setAccountSortField] = useState<AccountSortField>('totalVariance');
  const [accountSortAscending, setAccountSortAscending] = useState(false);

  // Drill-down state - Goal tab (shows transactions)
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [drilldownData, setDrilldownData] = useState<TransactionDrilldown | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Drill-down state - Account tab (shows goals)
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [accountDrilldownData, setAccountDrilldownData] = useState<FundComparisonRow[]>([]);
  const [accountDrilldownLoading, setAccountDrilldownLoading] = useState(false);

  // Initialize date range
  useEffect(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
  }, []);

  // Fetch data when dates or tab change
  useEffect(() => {
    if (startDate && endDate) {
      if (activeTab === 'goal') {
        fetchGoalData();
      } else {
        fetchAccountData();
      }
    }
  }, [startDate, endDate, activeTab]);

  // Sorted data for Goal tab using absolute value
  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      if (sortField === 'goalNumber') {
        return sortAscending
          ? a.goalNumber.localeCompare(b.goalNumber)
          : b.goalNumber.localeCompare(a.goalNumber);
      }

      const absA = Math.abs(a[sortField]);
      const absB = Math.abs(b[sortField]);
      return sortAscending ? absA - absB : absB - absA;
    });
    return sorted;
  }, [data, sortField, sortAscending]);

  // Sorted data for Account tab using absolute value
  const sortedAccountData = useMemo(() => {
    const sorted = [...accountData].sort((a, b) => {
      if (accountSortField === 'accountNumber') {
        return accountSortAscending
          ? a.accountNumber.localeCompare(b.accountNumber)
          : b.accountNumber.localeCompare(a.accountNumber);
      }
      if (accountSortField === 'goalCount') {
        return accountSortAscending
          ? a.goalCount - b.goalCount
          : b.goalCount - a.goalCount;
      }

      const absA = Math.abs(a[accountSortField]);
      const absB = Math.abs(b[accountSortField]);
      return accountSortAscending ? absA - absB : absB - absA;
    });
    return sorted;
  }, [accountData, accountSortField, accountSortAscending]);

  const fetchGoalData = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFundComparison({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        accountNumber: accountNumber || undefined,
        clientSearch: clientSearch || undefined,
        status: status !== "ALL" ? status : undefined,
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

  const fetchAccountData = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAccountFundComparison({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        accountNumber: accountNumber || undefined,
        clientSearch: clientSearch || undefined,
        status: status !== "ALL" ? status : undefined,
        page,
        limit: accountPagination.limit,
      });
      setAccountData(result.data);
      setAccountAggregates(result.aggregates);
      setAccountPagination(result.pagination);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (activeTab === 'goal') {
      fetchGoalData(1);
    } else {
      fetchAccountData(1);
    }
  };

  const handleReset = () => {
    setGoalNumber("");
    setAccountNumber("");
    setClientSearch("");
    setStatus("ALL");
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
    if (activeTab === 'goal') {
      fetchGoalData(1);
    } else {
      fetchAccountData(1);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportFundComparisonCSV({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        accountNumber: accountNumber || undefined,
        clientSearch: clientSearch || undefined,
        status: status !== "ALL" ? status : undefined,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // Goal tab drill-down handler - shows transactions
  const handleGoalRowClick = async (row: FundComparisonRow) => {
    if (expandedGoal === row.goalNumber) {
      setExpandedGoal(null);
      setDrilldownData(null);
      return;
    }

    setExpandedGoal(row.goalNumber);
    setDrilldownLoading(true);

    try {
      const result = await fetchGoalTransactionsWithMatching(row.goalNumber, {
        startDate,
        endDate,
      });
      setDrilldownData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDrilldownLoading(false);
    }
  };

  // Account tab drill-down handler - shows goals
  const handleAccountRowClick = async (row: AccountFundComparisonRow) => {
    if (expandedAccount === row.accountNumber) {
      setExpandedAccount(null);
      setAccountDrilldownData([]);
      return;
    }

    setExpandedAccount(row.accountNumber);
    setAccountDrilldownLoading(true);

    try {
      // Fetch goals for this account
      const result = await fetchFundComparison({
        startDate,
        endDate,
        accountNumber: row.accountNumber,
        limit: 100, // Get all goals for this account
      });
      setAccountDrilldownData(result.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAccountDrilldownLoading(false);
    }
  };

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortAscending(!sortAscending);
    } else {
      setSortField(field);
      setSortAscending(false);
    }
  };

  const handleAccountSortChange = (field: AccountSortField) => {
    if (accountSortField === field) {
      setAccountSortAscending(!accountSortAscending);
    } else {
      setAccountSortField(field);
      setAccountSortAscending(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-UG", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getVarianceColor = (variance: number) => {
    if (variance === 0) return "text-green-600 bg-green-50";
    return "text-red-600 bg-red-50";
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
      onClick={() => handleSortChange(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortField === field ? 'text-blue-600' : 'text-gray-400'}`} />
        {sortField === field && (
          <span className="text-xs text-blue-600">
            {sortAscending ? '(asc)' : '(desc)'}
          </span>
        )}
      </div>
    </th>
  );

  const AccountSortHeader = ({ field, label }: { field: AccountSortField; label: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
      onClick={() => handleAccountSortChange(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${accountSortField === field ? 'text-blue-600' : 'text-gray-400'}`} />
        {accountSortField === field && (
          <span className="text-xs text-blue-600">
            {accountSortAscending ? '(asc)' : '(desc)'}
          </span>
        )}
      </div>
    </th>
  );

  const currentAggregates = activeTab === 'goal' ? aggregates : accountAggregates;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fund Comparison</h1>
            <p className="text-sm text-gray-500">
              Compare fund-level variances with absolute value sorting
            </p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('goal')}
            className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'goal'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Target className="h-4 w-4" />
            Goal Summary
          </button>
          <button
            onClick={() => setActiveTab('account')}
            className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'account'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Briefcase className="h-4 w-4" />
            Account Summary
          </button>
        </nav>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Calendar className="inline h-4 w-4 mr-1" />
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Calendar className="inline h-4 w-4 mr-1" />
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {activeTab === 'goal' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Goal Number
              </label>
              <input
                type="text"
                value={goalNumber}
                onChange={(e) => setGoalNumber(e.target.value)}
                placeholder="e.g., 701-123a"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          )}
          {activeTab === 'account' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Account Number
              </label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g., 701-123456"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client Search
            </label>
            <input
              type="text"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Client name..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="ALL">All</option>
              <option value="MATCHED">Matched Only</option>
              <option value="VARIANCE">Variance Only</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Aggregates Summary */}
      {currentAggregates && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">XUMMF Variance</div>
            <div className={`text-lg font-bold ${currentAggregates.xummfVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(currentAggregates.xummfVariance)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">XUBF Variance</div>
            <div className={`text-lg font-bold ${currentAggregates.xubfVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(currentAggregates.xubfVariance)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">XUDEF Variance</div>
            <div className={`text-lg font-bold ${currentAggregates.xudefVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(currentAggregates.xudefVariance)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">XUREF Variance</div>
            <div className={`text-lg font-bold ${currentAggregates.xurefVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(currentAggregates.xurefVariance)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">Total Variance</div>
            <div className={`text-lg font-bold ${currentAggregates.totalVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(currentAggregates.totalVariance)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-500">Match Rate</div>
            <div className="text-lg font-bold text-blue-600">
              {currentAggregates.matchRate.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500">
              {currentAggregates.matchedCount} matched / {currentAggregates.varianceCount} variance
            </div>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Goal Tab Content */}
      {activeTab === 'goal' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8"></th>
                  <SortHeader field="goalNumber" label="Goal Number" />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Client
                  </th>
                  <SortHeader field="xummfVariance" label="XUMMF Var" />
                  <SortHeader field="xubfVariance" label="XUBF Var" />
                  <SortHeader field="xudefVariance" label="XUDEF Var" />
                  <SortHeader field="xurefVariance" label="XUREF Var" />
                  <SortHeader field="totalVariance" label="Total Var" />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                      <p className="mt-2 text-gray-500">Loading goal comparison data...</p>
                    </td>
                  </tr>
                ) : sortedData.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                      No data found for the selected criteria
                    </td>
                  </tr>
                ) : (
                  sortedData.map((row) => (
                    <React.Fragment key={row.goalNumber}>
                      <tr
                        className={`hover:bg-gray-50 cursor-pointer ${
                          expandedGoal === row.goalNumber ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => handleGoalRowClick(row)}
                      >
                        <td className="px-4 py-3">
                          {expandedGoal === row.goalNumber ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {row.goalNumber}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          <div>{row.clientName}</div>
                          <div className="text-xs text-gray-400">{row.accountNumber}</div>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xummfVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xummfVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xubfVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xubfVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xudefVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xudefVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xurefVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xurefVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-bold ${getVarianceColor(row.totalVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.totalVariance)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.status === 'MATCHED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle2 className="h-3 w-3" />
                              Matched
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <AlertTriangle className="h-3 w-3" />
                              Variance
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Goal Drill-down Panel - Shows Transactions */}
                      {expandedGoal === row.goalNumber && (
                        <tr>
                          <td colSpan={9} className="px-4 py-4 bg-gray-50">
                            {drilldownLoading ? (
                              <div className="text-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-600" />
                                <p className="mt-2 text-gray-500">Loading transaction details...</p>
                              </div>
                            ) : drilldownData ? (
                              <div className="space-y-4">
                                {/* Drilldown Summary */}
                                <div className="grid grid-cols-3 gap-4 mb-4">
                                  <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <div className="text-xs text-gray-500">Bank Transactions</div>
                                    <div className="text-lg font-bold text-blue-600">
                                      {drilldownData.summary.bankCount}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                      {drilldownData.summary.matchedBankCount} matched / {drilldownData.summary.unmatchedBankCount} unmatched
                                    </div>
                                  </div>
                                  <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <div className="text-xs text-gray-500">Goal Transactions</div>
                                    <div className="text-lg font-bold text-purple-600">
                                      {drilldownData.summary.goalTxnCount}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                      {drilldownData.summary.matchedGoalTxnCount} matched / {drilldownData.summary.unmatchedGoalTxnCount} unmatched
                                    </div>
                                  </div>
                                  <div className="bg-white rounded-lg p-3 shadow-sm">
                                    <div className="text-xs text-gray-500">Match Types</div>
                                    <div className="text-sm">
                                      <span className="text-green-600">Exact: {drilldownData.summary.exactMatches}</span>
                                      {' / '}
                                      <span className="text-blue-600">Amount: {drilldownData.summary.amountMatches}</span>
                                      {' / '}
                                      <span className="text-purple-600">Split: {drilldownData.summary.splitMatches}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Bank Transactions */}
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                    Bank Transactions ({drilldownData.bankTransactions.length})
                                  </h4>
                                  <div className="bg-white rounded border overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                      <thead className="bg-blue-50">
                                        <tr>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUMMF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUBF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUDEF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUREF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Match</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {drilldownData.bankTransactions.map((txn) => (
                                          <tr key={txn.id} className={txn.isMatched ? 'bg-green-50' : ''}>
                                            <td className="px-3 py-2 text-gray-600">{txn.transactionDate}</td>
                                            <td className="px-3 py-2">
                                              <span className={`px-2 py-0.5 rounded text-xs ${
                                                txn.transactionType === 'DEPOSIT'
                                                  ? 'bg-green-100 text-green-700'
                                                  : 'bg-orange-100 text-orange-700'
                                              }`}>
                                                {txn.transactionType}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xummfAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xubfAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xudefAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xurefAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono font-bold">{formatCurrency(txn.totalAmount)}</td>
                                            <td className="px-3 py-2 text-center">
                                              {txn.isMatched ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                                              ) : (
                                                <AlertTriangle className="h-4 w-4 text-orange-500 inline" />
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* Goal Transactions */}
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                    Goal Transactions ({drilldownData.goalTransactions.length})
                                  </h4>
                                  <div className="bg-white rounded border overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                      <thead className="bg-purple-50">
                                        <tr>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUMMF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUBF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUDEF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUREF</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Match</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {drilldownData.goalTransactions.map((txn) => (
                                          <tr key={txn.goalTransactionCode} className={txn.isMatched ? 'bg-green-50' : ''}>
                                            <td className="px-3 py-2 text-gray-600">{txn.transactionDate}</td>
                                            <td className="px-3 py-2">
                                              <span className={`px-2 py-0.5 rounded text-xs ${
                                                txn.transactionType === 'DEPOSIT'
                                                  ? 'bg-green-100 text-green-700'
                                                  : 'bg-orange-100 text-orange-700'
                                              }`}>
                                                {txn.transactionType}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xummfAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xubfAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xudefAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(txn.xurefAmount)}</td>
                                            <td className="px-3 py-2 text-right font-mono font-bold">{formatCurrency(txn.totalAmount)}</td>
                                            <td className="px-3 py-2 text-center">
                                              {txn.isMatched ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                                              ) : (
                                                <AlertTriangle className="h-4 w-4 text-orange-500 inline" />
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500">
                                No transaction details available
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Goal Tab Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total} results
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchGoalData(pagination.page - 1)}
                  disabled={pagination.page === 1 || loading}
                  className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-gray-700">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => fetchGoalData(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages || loading}
                  className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Account Tab Content */}
      {activeTab === 'account' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-8"></th>
                  <AccountSortHeader field="accountNumber" label="Account" />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Client
                  </th>
                  <AccountSortHeader field="goalCount" label="Goals" />
                  <AccountSortHeader field="xummfVariance" label="XUMMF Var" />
                  <AccountSortHeader field="xubfVariance" label="XUBF Var" />
                  <AccountSortHeader field="xudefVariance" label="XUDEF Var" />
                  <AccountSortHeader field="xurefVariance" label="XUREF Var" />
                  <AccountSortHeader field="totalVariance" label="Total Var" />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                      <p className="mt-2 text-gray-500">Loading account comparison data...</p>
                    </td>
                  </tr>
                ) : sortedAccountData.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center text-gray-500">
                      No data found for the selected criteria
                    </td>
                  </tr>
                ) : (
                  sortedAccountData.map((row) => (
                    <React.Fragment key={row.accountNumber}>
                      <tr
                        className={`hover:bg-gray-50 cursor-pointer ${
                          expandedAccount === row.accountNumber ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => handleAccountRowClick(row)}
                      >
                        <td className="px-4 py-3">
                          {expandedAccount === row.accountNumber ? (
                            <ChevronUp className="h-4 w-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {row.accountNumber}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {row.clientName}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="font-medium text-gray-900">{row.goalCount}</span>
                          <span className="text-xs text-gray-500 ml-1">
                            ({row.matchedGoalCount}
                            <span className="text-green-600">/</span>
                            {row.varianceGoalCount})
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xummfVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xummfVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xubfVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xubfVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xudefVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xudefVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-medium ${getVarianceColor(row.xurefVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.xurefVariance)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm font-bold ${getVarianceColor(row.totalVariance)}`}>
                          <span className="px-2 py-1 rounded">
                            {formatCurrency(row.totalVariance)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.status === 'MATCHED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <CheckCircle2 className="h-3 w-3" />
                              Matched
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <AlertTriangle className="h-3 w-3" />
                              Variance
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Account Drill-down Panel - Shows Goals */}
                      {expandedAccount === row.accountNumber && (
                        <tr>
                          <td colSpan={10} className="px-4 py-4 bg-gray-50">
                            {accountDrilldownLoading ? (
                              <div className="text-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-600" />
                                <p className="mt-2 text-gray-500">Loading goals...</p>
                              </div>
                            ) : accountDrilldownData.length > 0 ? (
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                  Goals in Account ({accountDrilldownData.length})
                                </h4>
                                <div className="bg-white rounded border overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-purple-50">
                                      <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Goal Number</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUMMF Var</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUBF Var</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUDEF Var</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">XUREF Var</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total Var</th>
                                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {accountDrilldownData.map((goal) => (
                                        <tr key={goal.goalNumber} className={goal.status === 'MATCHED' ? 'bg-green-50' : ''}>
                                          <td className="px-3 py-2 font-medium text-gray-900">{goal.goalNumber}</td>
                                          <td className={`px-3 py-2 text-right font-mono ${goal.xummfVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(goal.xummfVariance)}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-mono ${goal.xubfVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(goal.xubfVariance)}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-mono ${goal.xudefVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(goal.xudefVariance)}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-mono ${goal.xurefVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(goal.xurefVariance)}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-mono font-bold ${goal.totalVariance === 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(goal.totalVariance)}
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            {goal.status === 'MATCHED' ? (
                                              <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                                            ) : (
                                              <AlertTriangle className="h-4 w-4 text-orange-500 inline" />
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-500">
                                No goals found for this account
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Account Tab Pagination */}
          {accountPagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {((accountPagination.page - 1) * accountPagination.limit) + 1} to{' '}
                {Math.min(accountPagination.page * accountPagination.limit, accountPagination.total)} of{' '}
                {accountPagination.total} results
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchAccountData(accountPagination.page - 1)}
                  disabled={accountPagination.page === 1 || loading}
                  className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-gray-700">
                  Page {accountPagination.page} of {accountPagination.totalPages}
                </span>
                <button
                  onClick={() => fetchAccountData(accountPagination.page + 1)}
                  disabled={accountPagination.page === accountPagination.totalPages || loading}
                  className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FundComparison;
