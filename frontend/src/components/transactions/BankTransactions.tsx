import React, { useState, useEffect } from "react";
import {
  Building2,
  Search,
  Download,
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
  CheckCircle2,
  Clock,
  XCircle,
  MoreVertical,
  Check,
  X,
  Edit3,
  AlertTriangle,
  PlayCircle,
} from "lucide-react";
import {
  fetchBankTransactions,
  exportBankTransactionsCSV,
  updateBankTransactionStatus,
  bulkUpdateBankTransactionStatus,
  runBankReconciliation,
} from "../../services/api";

interface BankTransaction {
  id: string;
  transactionDate: string;
  transactionType: string;
  transactionId: string;
  clientName: string;
  firstName: string;
  lastName: string;
  accountNumber: string;
  goalNumber: string;
  goalTitle: string;
  totalAmount: number;
  xummfPercentage: number;
  xubfPercentage: number;
  xudefPercentage: number;
  xurefPercentage: number;
  xummfAmount: number;
  xubfAmount: number;
  xudefAmount: number;
  xurefAmount: number;
  reconciliationStatus: string;
  uploadBatchId: string;
}

interface Aggregates {
  totalCount: number;
  totalAmount: number;
  totalXUMMF: number;
  totalXUBF: number;
  totalXUDEF: number;
  totalXUREF: number;
  depositCount: number;
  depositAmount: number;
  withdrawalCount: number;
  withdrawalAmount: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const BankTransactions = () => {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
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
  const [transactionType, setTransactionType] = useState("");
  const [reconciliationStatus, setReconciliationStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  // Status change state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusModalTransaction, setStatusModalTransaction] = useState<BankTransaction | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [statusNotes, setStatusNotes] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Reconciliation state
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState<{
    processed: number;
    matched: number;
    unmatched: number;
    autoApproved: number;
    manualReview: number;
    errors: string[];
    totalPending: number;
    hasMore: boolean;
  } | null>(null);
  const [showReconciliationResult, setShowReconciliationResult] = useState(false);
  const [batchSize, setBatchSize] = useState(2000);

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
      if (transactionType) params.append("transactionType", transactionType);
      if (reconciliationStatus) params.append("reconciliationStatus", reconciliationStatus);
      params.append("page", page.toString());
      params.append("limit", pagination.limit.toString());

      const response = await fetchBankTransactions(params);
      setTransactions(response.data || []);
      setAggregates(response.aggregates || null);
      setPagination(response.pagination || {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
      });
    } catch (err) {
      console.error("Failed to fetch bank transactions:", err);
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
      if (transactionType) params.append("transactionType", transactionType);
      if (reconciliationStatus) params.append("reconciliationStatus", reconciliationStatus);

      const blob = await exportBankTransactionsCSV(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bank_transactions_${new Date().toISOString().split("T")[0]}.csv`;
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
    fetchTransactions(1);
  };

  const handleReset = () => {
    setSearchTerm("");
    setStartDate("");
    setEndDate("");
    setTransactionType("");
    setReconciliationStatus("");
    fetchTransactions(1);
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
      if (currentPage > 3) {
        pages.push('...');
      }
      const startPage = Math.max(2, currentPage - 1);
      const endPage = Math.min(totalPages - 1, currentPage + 1);
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) {
        pages.push('...');
      }
      pages.push(totalPages);
    }

    return pages;
  };

  // Status change handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(transactions.map((t) => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedIds(newSet);
  };

  const openStatusModal = (transaction?: BankTransaction) => {
    setStatusModalTransaction(transaction || null);
    setNewStatus("");
    setStatusNotes("");
    setStatusModalOpen(true);
  };

  const closeStatusModal = () => {
    setStatusModalOpen(false);
    setStatusModalTransaction(null);
    setNewStatus("");
    setStatusNotes("");
  };

  const handleStatusChange = async () => {
    if (!newStatus) {
      alert("Please select a status");
      return;
    }

    setUpdatingStatus(true);
    try {
      if (statusModalTransaction) {
        // Single transaction update
        await updateBankTransactionStatus(
          statusModalTransaction.id,
          newStatus,
          statusNotes,
          "user"
        );
      } else if (selectedIds.size > 0) {
        // Bulk update
        await bulkUpdateBankTransactionStatus(
          Array.from(selectedIds),
          newStatus,
          statusNotes,
          "user"
        );
        setSelectedIds(new Set());
      }
      closeStatusModal();
      fetchTransactions(pagination.page);
    } catch (err) {
      console.error("Failed to update status:", err);
      alert("Failed to update status: " + (err as Error).message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleQuickStatusChange = async (transactionId: string, status: string) => {
    try {
      await updateBankTransactionStatus(transactionId, status, "", "user");
      fetchTransactions(pagination.page);
    } catch (err) {
      console.error("Failed to update status:", err);
      alert("Failed to update status: " + (err as Error).message);
    }
  };

  const handleRunReconciliation = async () => {
    setRunningReconciliation(true);
    setReconciliationResult(null);
    try {
      // If items are selected, only reconcile those; otherwise reconcile all pending
      const transactionIds = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      const result = await runBankReconciliation(transactionIds, batchSize);
      setReconciliationResult(result);
      setShowReconciliationResult(true);
      // Clear selection and refresh data
      setSelectedIds(new Set());
      fetchTransactions(pagination.page);
    } catch (err) {
      console.error("Failed to run reconciliation:", err);
      alert("Failed to run reconciliation: " + (err as Error).message);
    } finally {
      setRunningReconciliation(false);
    }
  };

  const summary = aggregates || {
    totalCount: 0,
    totalAmount: 0,
    totalXUMMF: 0,
    totalXUBF: 0,
    totalXUDEF: 0,
    totalXUREF: 0,
    depositCount: 0,
    depositAmount: 0,
    withdrawalCount: 0,
    withdrawalAmount: 0,
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

  const formatName = (name: string) => {
    if (!name) return "";
    return name
      .toLowerCase()
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const getTransactionTypeBadge = (type: string) => {
    const styles: { [key: string]: string } = {
      DEPOSIT: "bg-green-100 text-green-800",
      WITHDRAWAL: "bg-red-100 text-red-800",
      REDEMPTION: "bg-orange-100 text-orange-800",
      SWITCH: "bg-blue-100 text-blue-800",
      DIVIDEND: "bg-purple-100 text-purple-800",
      TRANSFER: "bg-gray-100 text-gray-800",
    };
    return styles[type] || "bg-gray-100 text-gray-800";
  };

  const getReconciliationStatusBadge = (status: string) => {
    switch (status) {
      case "MATCHED":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Matched
          </span>
        );
      case "PENDING":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </span>
        );
      case "AUTO_APPROVED":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Auto Approved
          </span>
        );
      case "VARIANCE_DETECTED":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Variance
          </span>
        );
      case "MANUAL_REVIEW":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
            <Edit3 className="h-3 w-3 mr-1" />
            Manual Review
          </span>
        );
      case "APPROVED":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
            <Check className="h-3 w-3 mr-1" />
            Approved
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
            <X className="h-3 w-3 mr-1" />
            Rejected
          </span>
        );
      case "MISSING_IN_FUND":
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
            <XCircle className="h-3 w-3 mr-1" />
            Missing in Fund
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Bank Transactions</h2>
            <p className="text-sm text-gray-600 mt-1">
              View and manage uploaded bank transaction records
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Bulk Actions - show when items selected */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 mr-4 px-3 py-1 bg-blue-50 rounded-lg border border-blue-200">
                <span className="text-sm font-medium text-blue-700">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={() => openStatusModal()}
                  className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                >
                  <Edit3 className="h-4 w-4 mr-1" />
                  Change Status
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="inline-flex items-center px-2 py-1.5 text-gray-600 text-sm hover:text-gray-800 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {/* Batch Size Selector */}
            <div className="flex items-center gap-1">
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value))}
                className="px-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                title="Transactions per batch"
              >
                <option value={1000}>1K/batch</option>
                <option value={2000}>2K/batch</option>
                <option value={5000}>5K/batch</option>
                <option value={10000}>10K/batch</option>
                <option value={20000}>20K/batch</option>
                <option value={50000}>50K/batch</option>
              </select>
              <button
                onClick={handleRunReconciliation}
                disabled={runningReconciliation}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                title={selectedIds.size > 0 ? `Reconcile ${selectedIds.size} selected` : "Reconcile all pending transactions"}
              >
                {runningReconciliation ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <PlayCircle className="h-5 w-5 mr-2" />
                )}
                {selectedIds.size > 0 ? `Reconcile (${selectedIds.size})` : "Run Reconciliation"}
              </button>
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
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
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
                placeholder="Search by client, account, goal, or TXN ID..."
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

          {/* Transaction Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <select
                value={transactionType}
                onChange={(e) => setTransactionType(e.target.value)}
                className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
              >
                <option value="">All Types</option>
                <option value="DEPOSIT">Deposit</option>
                <option value="WITHDRAWAL">Withdrawal</option>
                <option value="REDEMPTION">Redemption</option>
                <option value="SWITCH">Switch</option>
                <option value="DIVIDEND">Dividend</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>
          </div>

          {/* Reconciliation Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recon Status
            </label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <select
                value={reconciliationStatus}
                onChange={(e) => setReconciliationStatus(e.target.value)}
                className="pl-10 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
              >
                <option value="">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="MATCHED">Matched</option>
                <option value="AUTO_APPROVED">Auto Approved</option>
                <option value="VARIANCE_DETECTED">Variance Detected</option>
                <option value="MANUAL_REVIEW">Manual Review</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="MISSING_IN_FUND">Missing in Fund</option>
              </select>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Amount */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Total Amount</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatCurrency(summary.totalAmount)}
              </p>
              <p className="text-gray-400 text-sm mt-2">
                {summary.totalCount.toLocaleString()} transactions
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <DollarSign className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        {/* Deposits */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Total Deposits</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {formatCurrency(summary.depositAmount)}
              </p>
              <p className="text-gray-400 text-sm mt-2">
                {summary.depositCount.toLocaleString()} transactions
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        {/* Withdrawals */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Total Withdrawals</p>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {formatCurrency(summary.withdrawalAmount)}
              </p>
              <p className="text-gray-400 text-sm mt-2">
                {summary.withdrawalCount.toLocaleString()} transactions
              </p>
            </div>
            <div className="p-3 bg-red-100 rounded-full">
              <TrendingDown className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Fund Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">XUMMF</p>
          <p className="text-xl font-bold text-blue-600 mt-1">
            {formatCurrency(summary.totalXUMMF)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">XUBF</p>
          <p className="text-xl font-bold text-purple-600 mt-1">
            {formatCurrency(summary.totalXUBF)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">XUDEF</p>
          <p className="text-xl font-bold text-indigo-600 mt-1">
            {formatCurrency(summary.totalXUDEF)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">XUREF</p>
          <p className="text-xl font-bold text-teal-600 mt-1">
            {formatCurrency(summary.totalXUREF)}
          </p>
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
            <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <p className="text-lg font-medium">No bank transactions found</p>
            <p className="text-sm mt-2">
              Upload a bank transaction file to see transactions here
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === transactions.length && transactions.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transaction ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
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
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUMMF
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUBF
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUDEF
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    XUREF
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Recon Status
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((txn) => (
                  <tr
                    key={txn.id}
                    className={`hover:bg-gray-50 transition-colors ${selectedIds.has(txn.id) ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(txn.id)}
                        onChange={(e) => handleSelectOne(txn.id, e.target.checked)}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(txn.transactionDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-600">
                      {txn.transactionId}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getTransactionTypeBadge(txn.transactionType)}`}>
                        {txn.transactionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatName(txn.clientName)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {txn.accountNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div>
                        <div className="font-medium truncate max-w-32" title={txn.goalTitle}>
                          {txn.goalTitle}
                        </div>
                        <div className="text-gray-500 text-xs">
                          {txn.goalNumber}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                      {formatCurrency(txn.totalAmount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-600">
                      {formatCurrency(txn.xummfAmount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-purple-600">
                      {formatCurrency(txn.xubfAmount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-indigo-600">
                      {formatCurrency(txn.xudefAmount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-teal-600">
                      {formatCurrency(txn.xurefAmount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      {getReconciliationStatusBadge(txn.reconciliationStatus)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1">
                        {txn.reconciliationStatus !== 'APPROVED' && (
                          <button
                            onClick={() => handleQuickStatusChange(txn.id, 'APPROVED')}
                            className="p-1.5 text-green-600 hover:bg-green-100 rounded-full transition-colors"
                            title="Approve"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        {txn.reconciliationStatus !== 'REJECTED' && (
                          <button
                            onClick={() => handleQuickStatusChange(txn.id, 'REJECTED')}
                            className="p-1.5 text-red-600 hover:bg-red-100 rounded-full transition-colors"
                            title="Reject"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openStatusModal(txn)}
                          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                          title="More options"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </div>
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
            <div className="text-sm text-gray-600 text-center">
              Showing page {pagination.page} of {pagination.totalPages}
              <span className="ml-2">({transactions.length} of {pagination.total.toLocaleString()} transactions)</span>
            </div>

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
              Total across all pages: {pagination.total.toLocaleString()} transaction(s)
            </span>
            <div className="flex items-center space-x-6">
              <span className="text-gray-600">
                Total Amount: <span className="font-bold text-gray-900">{formatCurrency(summary.totalAmount)}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Status Change Modal */}
      {statusModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={closeStatusModal}
            />

            {/* Modal */}
            <div className="relative inline-block w-full max-w-lg p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {statusModalTransaction ? 'Change Transaction Status' : `Update ${selectedIds.size} Transaction(s)`}
                </h3>
                <button
                  onClick={closeStatusModal}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Transaction Info (single transaction) */}
              {statusModalTransaction && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-gray-500">Transaction ID:</span>
                      <span className="ml-2 font-mono">{statusModalTransaction.transactionId}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Amount:</span>
                      <span className="ml-2 font-semibold">{formatCurrency(statusModalTransaction.totalAmount)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Client:</span>
                      <span className="ml-2">{formatName(statusModalTransaction.clientName)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Current Status:</span>
                      <span className="ml-2">{getReconciliationStatusBadge(statusModalTransaction.reconciliationStatus)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Bulk update warning */}
              {!statusModalTransaction && selectedIds.size > 0 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-700">
                    You are about to update <strong>{selectedIds.size}</strong> transaction(s). This action cannot be undone.
                  </div>
                </div>
              )}

              {/* Status Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Status
                </label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a status...</option>
                  <option value="PENDING">Pending</option>
                  <option value="MATCHED">Matched</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="MANUAL_REVIEW">Manual Review</option>
                  <option value="MISSING_IN_FUND">Missing in Fund</option>
                </select>
              </div>

              {/* Notes */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={statusNotes}
                  onChange={(e) => setStatusNotes(e.target.value)}
                  rows={3}
                  placeholder="Add any notes about this status change..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeStatusModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStatusChange}
                  disabled={!newStatus || updatingStatus}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {updatingStatus ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Status'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reconciliation Results Modal */}
      {showReconciliationResult && reconciliationResult && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={() => setShowReconciliationResult(false)}
            />

            {/* Modal */}
            <div className="relative inline-block w-full max-w-lg p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Reconciliation Results
                </h3>
                <button
                  onClick={() => setShowReconciliationResult(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Summary */}
                <div className="p-3 bg-gray-100 rounded-lg text-center">
                  <p className="text-sm text-gray-600">Processed in This Batch (max {batchSize.toLocaleString()})</p>
                  <p className="text-3xl font-bold text-gray-900">{reconciliationResult.processed.toLocaleString()}</p>
                  {reconciliationResult.hasMore && (
                    <p className="text-sm text-orange-600 mt-1">
                      {(reconciliationResult.totalPending - reconciliationResult.processed).toLocaleString()} still pending - click "Continue" to process more
                    </p>
                  )}
                  {!reconciliationResult.hasMore && reconciliationResult.totalPending > 0 && (
                    <p className="text-sm text-green-600 mt-1">All pending transactions processed!</p>
                  )}
                </div>

                {/* Matching Criteria Info */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  <p className="font-medium mb-1">Matching Criteria:</p>
                  <p>Goal Number + Transaction ID must match between Bank and Fund systems</p>
                </div>

                {/* Results Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-sm font-medium text-green-700">Matched</p>
                    <p className="text-2xl font-bold text-green-700">{reconciliationResult.matched}</p>
                    <p className="text-xs text-green-600 mt-1">Amounts match within 1% tolerance</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-700">Auto Approved</p>
                    <p className="text-2xl font-bold text-blue-700">{reconciliationResult.autoApproved}</p>
                    <p className="text-xs text-blue-600 mt-1">Minor fund distribution differences</p>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg">
                    <p className="text-sm font-medium text-orange-700">Variance Detected</p>
                    <p className="text-2xl font-bold text-orange-700">{reconciliationResult.manualReview}</p>
                    <p className="text-xs text-orange-600 mt-1">Amount mismatch - needs review</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <p className="text-sm font-medium text-red-700">Not Found in Fund</p>
                    <p className="text-2xl font-bold text-red-700">{reconciliationResult.unmatched}</p>
                    <p className="text-xs text-red-600 mt-1">No matching Goal+TxnID in fund system</p>
                  </div>
                </div>

                {/* What to do next */}
                <div className="p-3 bg-gray-50 rounded-lg text-sm">
                  <p className="font-medium text-gray-700 mb-1">Next Steps:</p>
                  <ul className="text-gray-600 list-disc list-inside space-y-1">
                    <li>Filter by "Variance Detected" to review amount mismatches</li>
                    <li>Filter by "Missing in Fund" to find transactions not in fund system</li>
                    <li>Use Approve/Reject buttons to finalize reviewed items</li>
                  </ul>
                </div>

                {reconciliationResult.errors.length > 0 && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-medium text-red-800 mb-1">Errors:</p>
                    <ul className="text-sm text-red-700 list-disc list-inside">
                      {reconciliationResult.errors.slice(0, 5).map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                      {reconciliationResult.errors.length > 5 && (
                        <li>...and {reconciliationResult.errors.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowReconciliationResult(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Close
                </button>
                {reconciliationResult.hasMore && (
                  <button
                    onClick={() => {
                      setShowReconciliationResult(false);
                      handleRunReconciliation();
                    }}
                    disabled={runningReconciliation}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                  >
                    {runningReconciliation ? "Processing..." : `Continue (${(reconciliationResult.totalPending - reconciliationResult.processed).toLocaleString()} remaining)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankTransactions;
