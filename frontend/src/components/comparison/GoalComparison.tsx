import React, { useState, useEffect } from "react";
import {
  Target,
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
  RotateCcw,
  Play,
  X,
  Tag,
  FileSpreadsheet,
  Save,
} from "lucide-react";
import {
  fetchGoalComparison,
  fetchGoalTransactionsWithMatching,
  exportGoalComparisonCSV,
  runSmartMatching,
  fetchFundComparison,
  exportFundComparisonCSV,
  fetchVarianceTransactions,
  exportVarianceTransactionsExcel,
  reviewBankTransaction,
  reviewGoalTransaction,
  bulkReviewTransactions,
  VARIANCE_REVIEW_TAGS,
} from "../../services/api";
import type {
  SmartMatchingResult,
  FundComparisonRow,
  FundComparisonAggregates,
  VarianceTransaction,
  VarianceTransactionsSummary,
  VarianceReviewTag,
} from "../../services/api";

interface GoalSummary {
  goalNumber: string;
  clientName: string;
  accountNumber: string;
  bankDeposits: number;
  goalTxnDeposits: number;
  depositVariance: number;
  depositBankCount: number;
  depositGoalTxnCount: number;
  bankWithdrawals: number;
  goalTxnWithdrawals: number;
  withdrawalVariance: number;
  withdrawalBankCount: number;
  withdrawalGoalTxnCount: number;
  // Primary status based on amount comparison
  status: "MATCHED" | "VARIANCE";
  hasVariance: boolean;
  // Review status for variance goals (independent of Smart Matching)
  reviewStatus: "NOT_APPLICABLE" | "UNREVIEWED" | "PARTIALLY_REVIEWED" | "REVIEWED";
  unreviewedCount: number;
  reviewedCount: number;
}

interface Aggregates {
  totalBankDeposits: number;
  totalGoalTxnDeposits: number;
  depositVariance: number;
  totalBankWithdrawals: number;
  totalGoalTxnWithdrawals: number;
  withdrawalVariance: number;
  matchedCount: number;
  varianceCount: number;
  matchRate: number;
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
  // Review fields
  reviewTag: VarianceReviewTag | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
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
  // Review fields
  reviewTag: VarianceReviewTag | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
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

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const GoalComparison = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState<'goal' | 'fund' | 'variance'>('goal');

  // Goal comparison state
  const [data, setData] = useState<GoalSummary[]>([]);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  // Fund comparison state
  const [fundData, setFundData] = useState<FundComparisonRow[]>([]);
  const [fundAggregates, setFundAggregates] = useState<FundComparisonAggregates | null>(null);
  const [fundPagination, setFundPagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });

  // Variance Review state
  const [varianceData, setVarianceData] = useState<VarianceTransaction[]>([]);
  const [varianceSummary, setVarianceSummary] = useState<VarianceTransactionsSummary | null>(null);
  const [variancePagination, setVariancePagination] = useState<Pagination>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  });
  const [varianceReviewStatus, setVarianceReviewStatus] = useState<'PENDING' | 'REVIEWED' | 'ALL'>('REVIEWED');
  const [varianceTagFilter, setVarianceTagFilter] = useState('');
  const [reviewingTransaction, setReviewingTransaction] = useState<{id: string; type: 'BANK' | 'GOAL'} | null>(null);
  const [selectedReviewTag, setSelectedReviewTag] = useState<VarianceReviewTag | ''>('');
  const [reviewNotes, setReviewNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [runningMatching, setRunningMatching] = useState(false);

  // Filter state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goalNumber, setGoalNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  // Expanded rows / drilldown state
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [drilldownData, setDrilldownData] = useState<TransactionDrilldown | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Drill-down review editing state
  const [drilldownReviewingTxn, setDrilldownReviewingTxn] = useState<{
    id: string;
    type: 'BANK' | 'GOAL';
  } | null>(null);
  const [drilldownReviewTag, setDrilldownReviewTag] = useState<VarianceReviewTag | ''>('');
  const [drilldownReviewNotes, setDrilldownReviewNotes] = useState('');

  // Batch tagging state - stores pending (unsaved) tags
  const [pendingTags, setPendingTags] = useState<Map<string, { type: 'BANK' | 'GOAL'; tag: VarianceReviewTag; notes: string }>>(new Map());
  const [savingTags, setSavingTags] = useState(false);

  // Smart matching batch processing state
  const [batchSize, setBatchSize] = useState(100);
  const [matchingResult, setMatchingResult] = useState<SmartMatchingResult | null>(null);
  const [showMatchingResult, setShowMatchingResult] = useState(false);
  const [, setCurrentOffset] = useState(0);

  useEffect(() => {
    // Set default date range to last 30 days
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
  }, []);

  useEffect(() => {
    if (startDate && endDate) {
      if (activeTab === 'goal') {
        fetchData();
      } else if (activeTab === 'fund') {
        fetchFundData();
      } else if (activeTab === 'variance') {
        fetchVarianceData();
      }
    }
  }, [startDate, endDate, activeTab, varianceReviewStatus, varianceTagFilter]);

  const fetchData = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchGoalComparison({
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

  const fetchFundData = async (page: number = 1) => {
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
        limit: fundPagination.limit,
      });
      setFundData(result.data);
      setFundAggregates(result.aggregates);
      setFundPagination(result.pagination);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fetchVarianceData = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVarianceTransactions({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        clientSearch: clientSearch || undefined,
        reviewStatus: varianceReviewStatus !== 'ALL' ? varianceReviewStatus : undefined,
        reviewTag: varianceTagFilter || undefined,
        page,
        limit: variancePagination.limit,
      });
      setVarianceData(result.data);
      setVarianceSummary(result.summary);
      setVariancePagination(result.pagination);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleReviewTransaction = async (id: string, type: 'BANK' | 'GOAL', tag: VarianceReviewTag, notes: string) => {
    try {
      if (type === 'BANK') {
        await reviewBankTransaction(id, tag, notes || null, 'User'); // TODO: Get actual user
      } else {
        await reviewGoalTransaction(id, tag, notes || null, 'User');
      }
      // Refresh data
      fetchVarianceData(variancePagination.page);
      setReviewingTransaction(null);
      setSelectedReviewTag('');
      setReviewNotes('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Add a tag to the pending queue (no API call - just local state)
  const addPendingTag = (id: string, type: 'BANK' | 'GOAL', tag: VarianceReviewTag, notes: string) => {
    setPendingTags(prev => {
      const newMap = new Map(prev);
      newMap.set(id, { type, tag, notes });
      return newMap;
    });
    // Reset the editing state
    setDrilldownReviewingTxn(null);
    setDrilldownReviewTag('');
    setDrilldownReviewNotes('');
  };

  // Remove a pending tag
  const removePendingTag = (id: string) => {
    setPendingTags(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  };

  // Clear all pending tags
  const clearPendingTags = () => {
    setPendingTags(new Map());
  };

  // Save all pending tags at once, then refresh
  const saveAllPendingTags = async () => {
    if (pendingTags.size === 0) return;

    setSavingTags(true);
    try {
      // Separate bank and goal transaction IDs
      const bankIds: string[] = [];
      const goalCodes: string[] = [];
      let commonTag: VarianceReviewTag | null = null;
      let commonNotes: string | null = null;

      // Check if all pending tags have the same tag (for bulk API)
      const tagsArray = Array.from(pendingTags.entries());
      const firstTag = tagsArray[0]?.[1];
      const allSameTag = tagsArray.every(([, val]) => val.tag === firstTag?.tag);

      if (allSameTag && firstTag) {
        // Use bulk API
        for (const [id, { type }] of pendingTags) {
          if (type === 'BANK') {
            bankIds.push(id);
          } else {
            goalCodes.push(id);
          }
        }
        commonTag = firstTag.tag;
        commonNotes = firstTag.notes;

        await bulkReviewTransactions({
          bankTransactionIds: bankIds,
          goalTransactionCodes: goalCodes,
          reviewTag: commonTag,
          reviewNotes: commonNotes || null,
          reviewedBy: 'User',
        });
      } else {
        // Different tags - save individually
        for (const [id, { type, tag, notes }] of pendingTags) {
          if (type === 'BANK') {
            await reviewBankTransaction(id, tag, notes || null, 'User');
          } else {
            await reviewGoalTransaction(id, tag, notes || null, 'User');
          }
        }
      }

      // Clear pending tags
      setPendingTags(new Map());

      // Refresh drilldown data
      if (expandedGoal) {
        const result = await fetchGoalTransactionsWithMatching(expandedGoal, {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        setDrilldownData({
          bankTransactions: result.bankTransactions,
          goalTransactions: result.goalTransactions,
          summary: result.summary,
        });
      }

      // Refresh the main goal list to update the status
      await fetchData(pagination.page);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingTags(false);
    }
  };

  const handleApplyFilters = () => {
    setExpandedGoal(null);
    setDrilldownData(null);
    if (activeTab === 'goal') {
      fetchData(1);
    } else if (activeTab === 'fund') {
      fetchFundData(1);
    } else {
      fetchVarianceData(1);
    }
  };

  const handleResetFilters = () => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
    setGoalNumber("");
    setAccountNumber("");
    setClientSearch("");
    setStatus("ALL");
    setVarianceReviewStatus('ALL');
    setVarianceTagFilter('');
    setExpandedGoal(null);
    setDrilldownData(null);
    setTimeout(() => {
      if (activeTab === 'goal') {
        fetchData(1);
      } else if (activeTab === 'fund') {
        fetchFundData(1);
      } else {
        fetchVarianceData(1);
      }
    }, 0);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      if (activeTab === 'goal') {
        await exportGoalComparisonCSV({
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          goalNumber: goalNumber || undefined,
          accountNumber: accountNumber || undefined,
          clientSearch: clientSearch || undefined,
          status: status !== "ALL" ? status : undefined,
        });
      } else if (activeTab === 'fund') {
        await exportFundComparisonCSV({
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          goalNumber: goalNumber || undefined,
          accountNumber: accountNumber || undefined,
          clientSearch: clientSearch || undefined,
          status: status !== "ALL" ? status : undefined,
        });
      } else {
        await exportVarianceTransactionsExcel({
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          goalNumber: goalNumber || undefined,
          clientSearch: clientSearch || undefined,
          reviewStatus: varianceReviewStatus !== 'ALL' ? varianceReviewStatus : undefined,
          reviewTag: varianceTagFilter || undefined,
        });
      }
    } catch (err) {
      alert("Failed to export: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const handleRunMatching = async (offset: number = 0) => {
    // Only show confirm on first batch
    if (offset === 0 && !confirm("This will run smart matching on goals in the selected date range. Continue?")) {
      return;
    }
    setRunningMatching(true);
    setCurrentOffset(offset);
    try {
      const result = await runSmartMatching({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        applyUpdates: true,
        batchSize,
        offset,
      });
      setMatchingResult(result);
      setShowMatchingResult(true);
      fetchData(pagination.page);
    } catch (err) {
      alert("Failed to run matching: " + (err as Error).message);
    } finally {
      setRunningMatching(false);
    }
  };

  const handleContinueMatching = () => {
    if (matchingResult?.nextOffset) {
      setShowMatchingResult(false);
      handleRunMatching(matchingResult.nextOffset);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setExpandedGoal(null);
      setDrilldownData(null);
      fetchData(newPage);
    }
  };

  const handleFundPageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= fundPagination.totalPages) {
      setExpandedGoal(null);
      setDrilldownData(null);
      fetchFundData(newPage);
    }
  };

  // Count pending tags for a specific goal
  const getPendingTagsForGoal = (goalNum: string): number => {
    let count = 0;
    for (const [id, { type }] of pendingTags) {
      // Bank transaction IDs are UUIDs, goal transaction codes contain the goal number
      if (type === 'GOAL' && id.includes(goalNum)) {
        count++;
      }
      // For bank transactions, we need to check drilldown data
      if (type === 'BANK' && drilldownData && expandedGoal === goalNum) {
        const bankTxn = drilldownData.bankTransactions.find(b => b.id === id);
        if (bankTxn) count++;
      }
    }
    return count;
  };

  const handleGoalClick = async (goalNum: string) => {
    if (expandedGoal === goalNum) {
      setExpandedGoal(null);
      setDrilldownData(null);
      // Don't clear pending tags - allow tagging across multiple goals
      return;
    }

    // Don't clear pending tags when switching goals - allow cross-goal tagging
    setExpandedGoal(goalNum);
    setDrilldownLoading(true);
    try {
      const result = await fetchGoalTransactionsWithMatching(goalNum, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setDrilldownData({
        bankTransactions: result.bankTransactions,
        goalTransactions: result.goalTransactions,
        summary: result.summary,
      });
    } catch (err) {
      console.error("Failed to fetch drilldown:", err);
      setDrilldownData(null);
    } finally {
      setDrilldownLoading(false);
    }
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

  const getStatusIcon = (status: string, reviewStatus?: string) => {
    if (status === "MATCHED") {
      return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    }
    // For VARIANCE status, show icon based on review status
    if (reviewStatus === "REVIEWED") {
      return <CheckCircle2 className="h-5 w-5 text-blue-600" />;
    }
    return <AlertTriangle className="h-5 w-5 text-orange-500" />;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      MATCHED: "bg-green-100 text-green-800",
      VARIANCE: "bg-orange-100 text-orange-800",
    };
    return badges[status] || "bg-gray-100 text-gray-800";
  };

  const getReviewStatusBadge = (reviewStatus: string) => {
    const badges: Record<string, string> = {
      REVIEWED: "bg-blue-100 text-blue-800",
      PARTIALLY_REVIEWED: "bg-yellow-100 text-yellow-800",
      UNREVIEWED: "bg-red-100 text-red-800",
      NOT_APPLICABLE: "",
    };
    return badges[reviewStatus] || "";
  };

  const getReviewStatusText = (reviewStatus: string) => {
    const text: Record<string, string> = {
      REVIEWED: "Reviewed",
      PARTIALLY_REVIEWED: "Partial",
      UNREVIEWED: "Pending",
      NOT_APPLICABLE: "",
    };
    return text[reviewStatus] || "";
  };

  const getVarianceClass = (diff: number) => {
    if (diff === 0) return "text-gray-500";
    return diff > 0 ? "text-red-600" : "text-green-600";
  };

  const getRowBgClass = (status: string, reviewStatus?: string) => {
    if (status === "MATCHED") {
      return "bg-green-50 hover:bg-green-100";
    }
    // For VARIANCE status, color based on review status
    if (reviewStatus === "REVIEWED") {
      return "bg-blue-50 hover:bg-blue-100";
    }
    return "bg-orange-50 hover:bg-orange-100";
  };

  const getMatchTypeBadge = (type: string) => {
    const badges: Record<string, { bg: string; text: string }> = {
      EXACT: { bg: "bg-green-100", text: "text-green-800" },
      AMOUNT: { bg: "bg-blue-100", text: "text-blue-800" },
      SPLIT_BANK_TO_FUND: { bg: "bg-purple-100", text: "text-purple-800" },
      SPLIT_FUND_TO_BANK: { bg: "bg-indigo-100", text: "text-indigo-800" },
    };
    const badge = badges[type] || { bg: "bg-gray-100", text: "text-gray-800" };
    return `${badge.bg} ${badge.text}`;
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Target className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Goal Comparison</h1>
        </div>
        <p className="text-gray-600">
          Compare bank and fund transaction totals by goal to quickly identify variances
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('goal')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'goal'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Goal Comparison
        </button>
        <button
          onClick={() => setActiveTab('fund')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'fund'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Fund Comparison
        </button>
        <button
          onClick={() => setActiveTab('variance')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'variance'
              ? 'border-orange-600 text-orange-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Tag className="h-4 w-4" />
          Variance Review
          {varianceSummary && varianceSummary.pendingReview > 0 && (
            <span className="bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded-full">
              {varianceSummary.pendingReview}
            </span>
          )}
        </button>
      </div>

      {/* Goal Comparison Summary Cards */}
      {activeTab === 'goal' && aggregates && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Bank Deposits</p>
            <p className="text-xl font-bold text-blue-600">
              {formatCurrency(aggregates.totalBankDeposits)}
            </p>
          </div>
          <div className="bg-white border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Goal Txn Deposits</p>
            <p className="text-xl font-bold text-purple-600">
              {formatCurrency(aggregates.totalGoalTxnDeposits)}
            </p>
          </div>
          <div className="bg-white border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Deposit Variance</p>
            <p className={`text-xl font-bold ${getVarianceClass(aggregates.depositVariance)}`}>
              {aggregates.depositVariance > 0 ? "+" : ""}
              {formatCurrency(aggregates.depositVariance)}
            </p>
          </div>
          <div className="bg-white border border-green-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Match Rate</p>
            <p className="text-xl font-bold text-green-600">
              {aggregates.matchRate.toFixed(1)}%
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Goals</p>
            <p className="text-xl font-bold text-gray-900">
              <span className="text-green-600">{aggregates.matchedCount}</span>
              {" / "}
              <span className="text-orange-600">{aggregates.varianceCount}</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Matched / Variance
            </p>
          </div>
        </div>
      )}

      {/* Fund Comparison Summary Cards */}
      {activeTab === 'fund' && fundAggregates && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Bank Total</p>
            <p className="text-xl font-bold text-blue-600">
              {formatCurrency(fundAggregates.totalBankAmount)}
            </p>
          </div>
          <div className="bg-white border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Goal Total</p>
            <p className="text-xl font-bold text-purple-600">
              {formatCurrency(fundAggregates.totalGoalAmount)}
            </p>
          </div>
          <div className="bg-white border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Total Variance</p>
            <p className={`text-xl font-bold ${getVarianceClass(fundAggregates.totalVariance)}`}>
              {fundAggregates.totalVariance > 0 ? "+" : ""}
              {formatCurrency(fundAggregates.totalVariance)}
            </p>
          </div>
          <div className="bg-white border border-green-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Match Rate</p>
            <p className="text-xl font-bold text-green-600">
              {fundAggregates.matchRate.toFixed(1)}%
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Goals</p>
            <p className="text-xl font-bold text-gray-900">
              <span className="text-green-600">{fundAggregates.matchedCount}</span>
              {" / "}
              <span className="text-orange-600">{fundAggregates.varianceCount}</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Matched / Variance
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

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              <option value="MATCHED">Matched</option>
              <option value="VARIANCE">Variance</option>
              <option value="REVIEWED">Reviewed</option>
            </select>
          </div>
        </div>

        {/* Filter Actions */}
        <div className="flex flex-wrap gap-3 mt-4">
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
          {/* Batch Size Selector */}
          <div className="flex items-center gap-1">
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(parseInt(e.target.value))}
              className="px-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              title="Goals per batch"
            >
              <option value={100}>100/batch</option>
              <option value={500}>500/batch</option>
              <option value={1000}>1K/batch</option>
              <option value={5000}>5K/batch</option>
            </select>
            <button
              onClick={() => handleRunMatching(0)}
              disabled={runningMatching || data.length === 0}
              className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
            >
              {runningMatching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Smart Matching
            </button>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || (activeTab === 'goal' ? data.length === 0 : fundData.length === 0)}
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

      {/* Floating Save All Bar - shows when there are pending tags across any goals */}
      {pendingTags.size > 0 && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-200 rounded-full p-2">
              <Tag className="h-5 w-5 text-yellow-700" />
            </div>
            <div>
              <p className="font-medium text-yellow-800">
                {pendingTags.size} pending tag{pendingTags.size !== 1 ? 's' : ''} ready to save
              </p>
              <p className="text-sm text-yellow-600">
                Tags will be saved when you click "Save All & Refresh"
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={clearPendingTags}
              disabled={savingTags}
              className="inline-flex items-center px-4 py-2 text-sm bg-white border border-yellow-300 text-yellow-700 rounded-lg hover:bg-yellow-100 disabled:opacity-50"
            >
              <X className="h-4 w-4 mr-1" />
              Clear All
            </button>
            <button
              onClick={saveAllPendingTags}
              disabled={savingTags}
              className="inline-flex items-center px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {savingTags ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save All & Refresh
            </button>
          </div>
        </div>
      )}

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

      {/* Goal Comparison Table */}
      {!loading && activeTab === 'goal' && data.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10"></th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-24">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Goal Number</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bank Dep</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Goal Dep</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Dep Var</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bank Wth</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Goal Wth</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Wth Var</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.map((row) => (
                  <React.Fragment key={row.goalNumber}>
                    <tr
                      className={`${getRowBgClass(row.status, row.reviewStatus)} cursor-pointer transition-colors`}
                      onClick={() => handleGoalClick(row.goalNumber)}
                    >
                      <td className="px-3 py-3 text-center">
                        {expandedGoal === row.goalNumber ? (
                          <ChevronUp className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {getStatusIcon(row.status, row.reviewStatus)}
                          <div className="flex flex-col gap-0.5">
                            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${getStatusBadge(row.status)}`}>
                              {row.status}
                            </span>
                            {row.status === "VARIANCE" && row.reviewStatus !== "NOT_APPLICABLE" && (
                              <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${getReviewStatusBadge(row.reviewStatus)}`}>
                                {getReviewStatusText(row.reviewStatus)}
                                {row.unreviewedCount > 0 && ` (${row.unreviewedCount})`}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono">
                        <div className="flex items-center gap-2">
                          {row.goalNumber}
                          {/* Show pending tags badge */}
                          {(() => {
                            const count = Array.from(pendingTags.entries()).filter(([id, { type }]) => {
                              if (type === 'GOAL') return id.includes(row.goalNumber);
                              return false;
                            }).length;
                            if (count === 0) return null;
                            return (
                              <span className="bg-yellow-200 text-yellow-800 text-xs px-1.5 py-0.5 rounded-full">
                                {count} pending
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {row.clientName}
                        <div className="text-xs text-gray-500">{row.accountNumber}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className="text-blue-600 font-medium">{formatCurrency(row.bankDeposits)}</span>
                        <div className="text-xs text-gray-500">{row.depositBankCount} txn</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className="text-purple-600 font-medium">{formatCurrency(row.goalTxnDeposits)}</span>
                        <div className="text-xs text-gray-500">{row.depositGoalTxnCount} txn</div>
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${getVarianceClass(row.depositVariance)}`}>
                        {row.depositVariance !== 0 ? (
                          <>
                            {row.depositVariance > 0 ? "+" : ""}
                            {formatCurrency(row.depositVariance)}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className="text-blue-600 font-medium">{formatCurrency(row.bankWithdrawals)}</span>
                        <div className="text-xs text-gray-500">{row.withdrawalBankCount} txn</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className="text-purple-600 font-medium">{formatCurrency(row.goalTxnWithdrawals)}</span>
                        <div className="text-xs text-gray-500">{row.withdrawalGoalTxnCount} txn</div>
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-bold ${getVarianceClass(row.withdrawalVariance)}`}>
                        {row.withdrawalVariance !== 0 ? (
                          <>
                            {row.withdrawalVariance > 0 ? "+" : ""}
                            {formatCurrency(row.withdrawalVariance)}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                    {/* Expanded Row - Transaction Drilldown */}
                    {expandedGoal === row.goalNumber && (
                      <tr className="bg-gray-50">
                        <td colSpan={10} className="px-4 py-4">
                          {drilldownLoading ? (
                            <div className="flex justify-center py-8">
                              <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
                            </div>
                          ) : drilldownData ? (
                            <div>
                              {/* Summary Stats */}
                              <div className="grid grid-cols-6 gap-4 mb-4">
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Bank Transactions</p>
                                  <p className="text-lg font-bold text-blue-600">{drilldownData.summary.bankCount}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Goal Transactions</p>
                                  <p className="text-lg font-bold text-purple-600">{drilldownData.summary.goalTxnCount}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Exact Matches</p>
                                  <p className="text-lg font-bold text-green-600">{drilldownData.summary.exactMatches}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Amount Matches</p>
                                  <p className="text-lg font-bold text-blue-600">{drilldownData.summary.amountMatches}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Split Matches</p>
                                  <p className="text-lg font-bold text-purple-600">{drilldownData.summary.splitMatches}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Unmatched</p>
                                  <p className="text-lg font-bold text-orange-600">
                                    {drilldownData.summary.unmatchedBankCount + drilldownData.summary.unmatchedGoalTxnCount}
                                  </p>
                                </div>
                              </div>

                              {/* Two-column layout for bank and fund transactions */}
                              <div className="grid grid-cols-2 gap-4">
                                {/* Bank Transactions */}
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-2">Bank Transactions</h4>
                                  <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {drilldownData.bankTransactions.map((txn) => (
                                      <div
                                        key={txn.id}
                                        className={`border rounded p-2 text-sm ${
                                          txn.isMatched ? "bg-green-50 border-green-200" :
                                          txn.reviewTag ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"
                                        }`}
                                      >
                                        <div className="flex justify-between items-center">
                                          <span className="font-mono text-xs">{formatDate(txn.transactionDate)}</span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            txn.transactionType === "DEPOSIT" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                                          }`}>
                                            {txn.transactionType}
                                          </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                          <span className="text-xs text-gray-500">ID: {txn.transactionId}</span>
                                          <span className="font-bold text-blue-600">{formatCurrency(txn.totalAmount || 0)}</span>
                                        </div>
                                        {/* Fund breakdown for bank transactions */}
                                        <div className="mt-1 grid grid-cols-4 gap-1 text-xs text-gray-600">
                                          <span>XUMMF: {formatCurrency(txn.xummfAmount || 0)}</span>
                                          <span>XUBF: {formatCurrency(txn.xubfAmount || 0)}</span>
                                          <span>XUDEF: {formatCurrency(txn.xudefAmount || 0)}</span>
                                          <span>XUREF: {formatCurrency(txn.xurefAmount || 0)}</span>
                                        </div>
                                        {txn.matchInfo && (
                                          <div className="mt-1">
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${getMatchTypeBadge(txn.matchInfo.matchType)}`}>
                                              {txn.matchInfo.matchType.replace(/_/g, " ")}
                                            </span>
                                            <span className="text-xs text-gray-500 ml-2">
                                              {Math.round(txn.matchInfo.confidence * 100)}% confidence
                                            </span>
                                          </div>
                                        )}
                                        {/* Review tagging for unmatched bank transactions */}
                                        {!txn.isMatched && (
                                          <div className="mt-2 pt-2 border-t border-gray-200">
                                            {drilldownReviewingTxn?.id === txn.id && drilldownReviewingTxn?.type === 'BANK' ? (
                                              <div className="space-y-2">
                                                <select
                                                  value={drilldownReviewTag}
                                                  onChange={(e) => setDrilldownReviewTag(e.target.value as VarianceReviewTag)}
                                                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
                                                >
                                                  <option value="">Select tag...</option>
                                                  {VARIANCE_REVIEW_TAGS.map((tag) => (
                                                    <option key={tag.value} value={tag.value}>{tag.label}</option>
                                                  ))}
                                                </select>
                                                <input
                                                  type="text"
                                                  value={drilldownReviewNotes}
                                                  onChange={(e) => setDrilldownReviewNotes(e.target.value)}
                                                  placeholder="Notes..."
                                                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
                                                />
                                                <div className="flex gap-1">
                                                  <button
                                                    onClick={() => {
                                                      if (drilldownReviewTag) {
                                                        addPendingTag(txn.id, 'BANK', drilldownReviewTag, drilldownReviewNotes);
                                                      }
                                                    }}
                                                    disabled={!drilldownReviewTag}
                                                    className="flex-1 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                                  >
                                                    Add Tag
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setDrilldownReviewingTxn(null);
                                                      setDrilldownReviewTag('');
                                                      setDrilldownReviewNotes('');
                                                    }}
                                                    className="flex-1 text-xs px-2 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                                                  >
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : pendingTags.has(txn.id) ? (
                                              <div className="flex items-center justify-between">
                                                <div>
                                                  <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-300">
                                                    {VARIANCE_REVIEW_TAGS.find(t => t.value === pendingTags.get(txn.id)?.tag)?.label || pendingTags.get(txn.id)?.tag}
                                                    <span className="ml-1 text-yellow-600">(pending)</span>
                                                  </span>
                                                </div>
                                                <button
                                                  onClick={() => removePendingTag(txn.id)}
                                                  className="text-xs px-2 py-0.5 text-red-600 hover:bg-red-50 rounded"
                                                >
                                                  Remove
                                                </button>
                                              </div>
                                            ) : txn.reviewTag ? (
                                              <div className="flex items-center justify-between">
                                                <div>
                                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                                                    {VARIANCE_REVIEW_TAGS.find(t => t.value === txn.reviewTag)?.label || txn.reviewTag}
                                                  </span>
                                                  {txn.reviewNotes && (
                                                    <span className="text-xs text-gray-500 ml-2" title={txn.reviewNotes}>
                                                      "{txn.reviewNotes.substring(0, 20)}{txn.reviewNotes.length > 20 ? '...' : ''}"
                                                    </span>
                                                  )}
                                                </div>
                                                <button
                                                  onClick={() => {
                                                    setDrilldownReviewingTxn({ id: txn.id, type: 'BANK' });
                                                    setDrilldownReviewTag(txn.reviewTag || '');
                                                    setDrilldownReviewNotes(txn.reviewNotes || '');
                                                  }}
                                                  className="text-xs px-2 py-0.5 text-blue-600 hover:bg-blue-50 rounded"
                                                >
                                                  Edit
                                                </button>
                                              </div>
                                            ) : (
                                              <button
                                                onClick={() => {
                                                  setDrilldownReviewingTxn({ id: txn.id, type: 'BANK' });
                                                  setDrilldownReviewTag('');
                                                  setDrilldownReviewNotes('');
                                                }}
                                                className="w-full text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                                              >
                                                Tag Variance
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Goal Transactions */}
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-2">Goal Transactions</h4>
                                  <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {drilldownData.goalTransactions.map((txn) => (
                                      <div
                                        key={txn.goalTransactionCode}
                                        className={`border rounded p-2 text-sm ${
                                          txn.isMatched ? "bg-green-50 border-green-200" :
                                          txn.reviewTag ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"
                                        }`}
                                      >
                                        <div className="flex justify-between items-center">
                                          <span className="font-mono text-xs">{formatDate(txn.transactionDate)}</span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            txn.transactionType === "DEPOSIT" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                                          }`}>
                                            {txn.transactionType}
                                          </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                          <span className="text-xs text-gray-500">
                                            ID: {txn.transactionId || "N/A"}
                                          </span>
                                          <span className="font-bold text-purple-600">{formatCurrency(txn.totalAmount)}</span>
                                        </div>
                                        {/* Fund breakdown for goal transactions */}
                                        <div className="mt-1 grid grid-cols-4 gap-1 text-xs text-gray-600">
                                          <span>XUMMF: {formatCurrency(txn.xummfAmount || 0)}</span>
                                          <span>XUBF: {formatCurrency(txn.xubfAmount || 0)}</span>
                                          <span>XUDEF: {formatCurrency(txn.xudefAmount || 0)}</span>
                                          <span>XUREF: {formatCurrency(txn.xurefAmount || 0)}</span>
                                        </div>
                                        {txn.matchInfo && (
                                          <div className="mt-1">
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${getMatchTypeBadge(txn.matchInfo.matchType)}`}>
                                              {txn.matchInfo.matchType.replace(/_/g, " ")}
                                            </span>
                                          </div>
                                        )}
                                        {/* Review tagging for unmatched goal transactions */}
                                        {!txn.isMatched && (
                                          <div className="mt-2 pt-2 border-t border-gray-200">
                                            {drilldownReviewingTxn?.id === txn.goalTransactionCode && drilldownReviewingTxn?.type === 'GOAL' ? (
                                              <div className="space-y-2">
                                                <select
                                                  value={drilldownReviewTag}
                                                  onChange={(e) => setDrilldownReviewTag(e.target.value as VarianceReviewTag)}
                                                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
                                                >
                                                  <option value="">Select tag...</option>
                                                  {VARIANCE_REVIEW_TAGS.map((tag) => (
                                                    <option key={tag.value} value={tag.value}>{tag.label}</option>
                                                  ))}
                                                </select>
                                                <input
                                                  type="text"
                                                  value={drilldownReviewNotes}
                                                  onChange={(e) => setDrilldownReviewNotes(e.target.value)}
                                                  placeholder="Notes..."
                                                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
                                                />
                                                <div className="flex gap-1">
                                                  <button
                                                    onClick={() => {
                                                      if (drilldownReviewTag) {
                                                        addPendingTag(txn.goalTransactionCode, 'GOAL', drilldownReviewTag, drilldownReviewNotes);
                                                      }
                                                    }}
                                                    disabled={!drilldownReviewTag}
                                                    className="flex-1 text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                                  >
                                                    Add Tag
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setDrilldownReviewingTxn(null);
                                                      setDrilldownReviewTag('');
                                                      setDrilldownReviewNotes('');
                                                    }}
                                                    className="flex-1 text-xs px-2 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                                                  >
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : pendingTags.has(txn.goalTransactionCode) ? (
                                              <div className="flex items-center justify-between">
                                                <div>
                                                  <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-300">
                                                    {VARIANCE_REVIEW_TAGS.find(t => t.value === pendingTags.get(txn.goalTransactionCode)?.tag)?.label || pendingTags.get(txn.goalTransactionCode)?.tag}
                                                    <span className="ml-1 text-yellow-600">(pending)</span>
                                                  </span>
                                                </div>
                                                <button
                                                  onClick={() => removePendingTag(txn.goalTransactionCode)}
                                                  className="text-xs px-2 py-0.5 text-red-600 hover:bg-red-50 rounded"
                                                >
                                                  Remove
                                                </button>
                                              </div>
                                            ) : txn.reviewTag ? (
                                              <div className="flex items-center justify-between">
                                                <div>
                                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                                                    {VARIANCE_REVIEW_TAGS.find(t => t.value === txn.reviewTag)?.label || txn.reviewTag}
                                                  </span>
                                                  {txn.reviewNotes && (
                                                    <span className="text-xs text-gray-500 ml-2" title={txn.reviewNotes}>
                                                      "{txn.reviewNotes.substring(0, 20)}{txn.reviewNotes.length > 20 ? '...' : ''}"
                                                    </span>
                                                  )}
                                                </div>
                                                <button
                                                  onClick={() => {
                                                    setDrilldownReviewingTxn({ id: txn.goalTransactionCode, type: 'GOAL' });
                                                    setDrilldownReviewTag(txn.reviewTag || '');
                                                    setDrilldownReviewNotes(txn.reviewNotes || '');
                                                  }}
                                                  className="text-xs px-2 py-0.5 text-blue-600 hover:bg-blue-50 rounded"
                                                >
                                                  Edit
                                                </button>
                                              </div>
                                            ) : (
                                              <button
                                                onClick={() => {
                                                  setDrilldownReviewingTxn({ id: txn.goalTransactionCode, type: 'GOAL' });
                                                  setDrilldownReviewTag('');
                                                  setDrilldownReviewNotes('');
                                                }}
                                                className="w-full text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                                              >
                                                Tag Variance
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {/* Pending Tags Indicator for this goal */}
                              {(() => {
                                // Count pending tags for current goal
                                const goalPendingCount = Array.from(pendingTags.entries()).filter(([id, { type }]) => {
                                  if (type === 'GOAL') return id.includes(expandedGoal || '');
                                  if (type === 'BANK' && drilldownData) {
                                    return drilldownData.bankTransactions.some(b => b.id === id);
                                  }
                                  return false;
                                }).length;

                                if (goalPendingCount === 0) return null;

                                return (
                                  <div className="mt-4 pt-3 border-t border-yellow-300 bg-yellow-50 -mx-4 px-4 py-2 rounded-b-lg">
                                    <div className="text-sm text-yellow-700 flex items-center gap-2">
                                      <Tag className="h-4 w-4" />
                                      <span>
                                        <span className="font-medium">{goalPendingCount}</span> pending tag{goalPendingCount !== 1 ? 's' : ''} in this goal
                                        {pendingTags.size > goalPendingCount && (
                                          <span className="text-yellow-600"> ({pendingTags.size} total across all goals)</span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <p className="text-gray-500 text-center py-4">No transaction data available</p>
                          )}
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
              {pagination.total.toLocaleString()} goals
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

      {/* Fund Comparison Table */}
      {!loading && activeTab === 'fund' && fundData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-1 py-2 text-left font-medium text-gray-500 uppercase w-8"></th>
                  <th className="px-1 py-2 text-center font-medium text-gray-500 uppercase w-16">Status</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase">Goal</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-1 py-2 text-right font-medium text-blue-600 uppercase">B.MMF</th>
                  <th className="px-1 py-2 text-right font-medium text-purple-600 uppercase">G.MMF</th>
                  <th className="px-1 py-2 text-right font-medium text-gray-500 uppercase">Var</th>
                  <th className="px-1 py-2 text-right font-medium text-blue-600 uppercase">B.UBF</th>
                  <th className="px-1 py-2 text-right font-medium text-purple-600 uppercase">G.UBF</th>
                  <th className="px-1 py-2 text-right font-medium text-gray-500 uppercase">Var</th>
                  <th className="px-1 py-2 text-right font-medium text-blue-600 uppercase">B.DEF</th>
                  <th className="px-1 py-2 text-right font-medium text-purple-600 uppercase">G.DEF</th>
                  <th className="px-1 py-2 text-right font-medium text-gray-500 uppercase">Var</th>
                  <th className="px-1 py-2 text-right font-medium text-blue-600 uppercase">B.REF</th>
                  <th className="px-1 py-2 text-right font-medium text-purple-600 uppercase">G.REF</th>
                  <th className="px-1 py-2 text-right font-medium text-gray-500 uppercase">Var</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {fundData.map((row) => (
                  <React.Fragment key={row.goalNumber}>
                    <tr
                      className={`${getRowBgClass(row.status)} cursor-pointer transition-colors`}
                      onClick={() => handleGoalClick(row.goalNumber)}
                    >
                      <td className="px-1 py-2 text-center">
                        {expandedGoal === row.goalNumber ? (
                          <ChevronUp className="h-3 w-3 text-gray-500" />
                        ) : (
                          <ChevronDown className="h-3 w-3 text-gray-500" />
                        )}
                      </td>
                      <td className="px-1 py-2">
                        <div className="flex items-center justify-center">
                          {getStatusIcon(row.status)}
                        </div>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">
                        <div className="flex items-center gap-1">
                          {row.goalNumber}
                          {/* Show pending tags badge */}
                          {(() => {
                            const count = Array.from(pendingTags.entries()).filter(([id, { type }]) => {
                              if (type === 'GOAL') return id.includes(row.goalNumber);
                              return false;
                            }).length;
                            if (count === 0) return null;
                            return (
                              <span className="bg-yellow-200 text-yellow-800 text-xs px-1 py-0.5 rounded-full">
                                {count}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-2 py-2 font-medium max-w-[120px] truncate" title={row.clientName}>
                        {row.clientName}
                        <div className="text-gray-500 truncate">{row.accountNumber}</div>
                      </td>
                      {/* XUMMF */}
                      <td className="px-1 py-2 text-right text-blue-600">{formatCurrency(row.bankXUMMF)}</td>
                      <td className="px-1 py-2 text-right text-purple-600">{formatCurrency(row.goalXUMMF)}</td>
                      <td className={`px-1 py-2 text-right font-bold ${getVarianceClass(row.xummfVariance)}`}>
                        {row.xummfVariance !== 0 ? formatCurrency(row.xummfVariance) : "-"}
                      </td>
                      {/* XUBF */}
                      <td className="px-1 py-2 text-right text-blue-600">{formatCurrency(row.bankXUBF)}</td>
                      <td className="px-1 py-2 text-right text-purple-600">{formatCurrency(row.goalXUBF)}</td>
                      <td className={`px-1 py-2 text-right font-bold ${getVarianceClass(row.xubfVariance)}`}>
                        {row.xubfVariance !== 0 ? formatCurrency(row.xubfVariance) : "-"}
                      </td>
                      {/* XUDEF */}
                      <td className="px-1 py-2 text-right text-blue-600">{formatCurrency(row.bankXUDEF)}</td>
                      <td className="px-1 py-2 text-right text-purple-600">{formatCurrency(row.goalXUDEF)}</td>
                      <td className={`px-1 py-2 text-right font-bold ${getVarianceClass(row.xudefVariance)}`}>
                        {row.xudefVariance !== 0 ? formatCurrency(row.xudefVariance) : "-"}
                      </td>
                      {/* XUREF */}
                      <td className="px-1 py-2 text-right text-blue-600">{formatCurrency(row.bankXUREF)}</td>
                      <td className="px-1 py-2 text-right text-purple-600">{formatCurrency(row.goalXUREF)}</td>
                      <td className={`px-1 py-2 text-right font-bold ${getVarianceClass(row.xurefVariance)}`}>
                        {row.xurefVariance !== 0 ? formatCurrency(row.xurefVariance) : "-"}
                      </td>
                    </tr>
                    {/* Expanded Row - Transaction Drilldown */}
                    {expandedGoal === row.goalNumber && (
                      <tr className="bg-gray-50">
                        <td colSpan={16} className="px-4 py-4">
                          {drilldownLoading ? (
                            <div className="flex justify-center py-8">
                              <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
                            </div>
                          ) : drilldownData ? (
                            <div>
                              {/* Summary Stats */}
                              <div className="grid grid-cols-6 gap-4 mb-4">
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Bank Transactions</p>
                                  <p className="text-lg font-bold text-blue-600">{drilldownData.summary.bankCount}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Goal Transactions</p>
                                  <p className="text-lg font-bold text-purple-600">{drilldownData.summary.goalTxnCount}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Exact Matches</p>
                                  <p className="text-lg font-bold text-green-600">{drilldownData.summary.exactMatches}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Amount Matches</p>
                                  <p className="text-lg font-bold text-blue-600">{drilldownData.summary.amountMatches}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Split Matches</p>
                                  <p className="text-lg font-bold text-purple-600">{drilldownData.summary.splitMatches}</p>
                                </div>
                                <div className="bg-white border rounded p-3">
                                  <p className="text-xs text-gray-500">Unmatched</p>
                                  <p className="text-lg font-bold text-orange-600">
                                    {drilldownData.summary.unmatchedBankCount + drilldownData.summary.unmatchedGoalTxnCount}
                                  </p>
                                </div>
                              </div>

                              {/* Two-column layout for bank and fund transactions */}
                              <div className="grid grid-cols-2 gap-4">
                                {/* Bank Transactions */}
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-2">Bank Transactions</h4>
                                  <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {drilldownData.bankTransactions.map((txn) => (
                                      <div
                                        key={txn.id}
                                        className={`border rounded p-2 text-sm ${
                                          txn.isMatched ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"
                                        }`}
                                      >
                                        <div className="flex justify-between items-center">
                                          <span className="font-mono text-xs">{formatDate(txn.transactionDate)}</span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            txn.transactionType === "DEPOSIT" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                                          }`}>
                                            {txn.transactionType}
                                          </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                          <span className="text-xs text-gray-500">ID: {txn.transactionId}</span>
                                          <span className="font-bold text-blue-600">{formatCurrency(txn.totalAmount || 0)}</span>
                                        </div>
                                        {/* Fund breakdown for bank transactions */}
                                        <div className="mt-1 grid grid-cols-4 gap-1 text-xs text-gray-600">
                                          <span>XUMMF: {formatCurrency(txn.xummfAmount || 0)}</span>
                                          <span>XUBF: {formatCurrency(txn.xubfAmount || 0)}</span>
                                          <span>XUDEF: {formatCurrency(txn.xudefAmount || 0)}</span>
                                          <span>XUREF: {formatCurrency(txn.xurefAmount || 0)}</span>
                                        </div>
                                        {txn.matchInfo && (
                                          <div className="mt-1">
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${getMatchTypeBadge(txn.matchInfo.matchType)}`}>
                                              {txn.matchInfo.matchType.replace(/_/g, " ")}
                                            </span>
                                            <span className="text-xs text-gray-500 ml-2">
                                              {Math.round(txn.matchInfo.confidence * 100)}% confidence
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Goal Transactions */}
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-2">Goal Transactions</h4>
                                  <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {drilldownData.goalTransactions.map((txn) => (
                                      <div
                                        key={txn.goalTransactionCode}
                                        className={`border rounded p-2 text-sm ${
                                          txn.isMatched ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"
                                        }`}
                                      >
                                        <div className="flex justify-between items-center">
                                          <span className="font-mono text-xs">{formatDate(txn.transactionDate)}</span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            txn.transactionType === "DEPOSIT" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                                          }`}>
                                            {txn.transactionType}
                                          </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                          <span className="text-xs text-gray-500">
                                            ID: {txn.transactionId || "N/A"}
                                          </span>
                                          <span className="font-bold text-purple-600">{formatCurrency(txn.totalAmount)}</span>
                                        </div>
                                        {/* Fund breakdown for goal transactions */}
                                        <div className="mt-1 grid grid-cols-4 gap-1 text-xs text-gray-600">
                                          <span>XUMMF: {formatCurrency(txn.xummfAmount || 0)}</span>
                                          <span>XUBF: {formatCurrency(txn.xubfAmount || 0)}</span>
                                          <span>XUDEF: {formatCurrency(txn.xudefAmount || 0)}</span>
                                          <span>XUREF: {formatCurrency(txn.xurefAmount || 0)}</span>
                                        </div>
                                        {txn.matchInfo && (
                                          <div className="mt-1">
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${getMatchTypeBadge(txn.matchInfo.matchType)}`}>
                                              {txn.matchInfo.matchType.replace(/_/g, " ")}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-500 text-center py-4">No transaction data available</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fund Comparison Pagination */}
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-700">
              Showing {((fundPagination.page - 1) * fundPagination.limit) + 1} to{" "}
              {Math.min(fundPagination.page * fundPagination.limit, fundPagination.total)} of{" "}
              {fundPagination.total.toLocaleString()} goals
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleFundPageChange(fundPagination.page - 1)}
                disabled={fundPagination.page <= 1 || loading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </button>
              <span className="text-sm text-gray-700 px-3">
                Page {fundPagination.page} of {fundPagination.totalPages}
              </span>
              <button
                onClick={() => handleFundPageChange(fundPagination.page + 1)}
                disabled={fundPagination.page >= fundPagination.totalPages || loading}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State - Goal Tab */}
      {!loading && activeTab === 'goal' && data.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No goal comparison data found</p>
          <p className="text-gray-500 text-sm mt-2">
            Try adjusting your date range or upload transactions first
          </p>
        </div>
      )}

      {/* Empty State - Fund Tab */}
      {!loading && activeTab === 'fund' && fundData.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No fund comparison data found</p>
          <p className="text-gray-500 text-sm mt-2">
            Try adjusting your date range or upload transactions first
          </p>
        </div>
      )}

      {/* Variance Review Tab Content */}
      {activeTab === 'variance' && (
        <>
          {/* Variance Summary Cards */}
          {varianceSummary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">Total Unmatched</p>
                <p className="text-2xl font-bold text-gray-900">
                  {varianceSummary.totalUnmatched.toLocaleString()}
                </p>
              </div>
              <div className="bg-white border border-orange-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">Pending Review</p>
                <p className="text-2xl font-bold text-orange-600">
                  {varianceSummary.pendingReview.toLocaleString()}
                </p>
              </div>
              <div className="bg-white border border-green-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">Reviewed</p>
                <p className="text-2xl font-bold text-green-600">
                  {varianceSummary.reviewed.toLocaleString()}
                </p>
              </div>
              <div className="bg-white border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">Review Progress</p>
                <p className="text-2xl font-bold text-blue-600">
                  {varianceSummary.totalUnmatched > 0
                    ? Math.round((varianceSummary.reviewed / varianceSummary.totalUnmatched) * 100)
                    : 0}%
                </p>
              </div>
            </div>
          )}

          {/* Variance Filters */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Review Status</label>
                <select
                  value={varianceReviewStatus}
                  onChange={(e) => setVarianceReviewStatus(e.target.value as 'PENDING' | 'REVIEWED' | 'ALL')}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="ALL">All</option>
                  <option value="PENDING">Pending Review</option>
                  <option value="REVIEWED">Reviewed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Review Tag</label>
                <select
                  value={varianceTagFilter}
                  onChange={(e) => setVarianceTagFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">All Tags</option>
                  {VARIANCE_REVIEW_TAGS.map((tag) => (
                    <option key={tag.value} value={tag.value}>
                      {tag.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleExport}
                disabled={exporting || varianceData.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Export Excel
              </button>
            </div>
          </div>

          {/* Variance Transactions Table */}
          {!loading && varianceData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Goal</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Review Tag</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {varianceData.map((txn) => (
                      <tr key={`${txn.transactionSource}-${txn.id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${
                            txn.transactionSource === 'BANK'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {txn.transactionSource}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono">{txn.goalNumber}</td>
                        <td className="px-4 py-3 text-sm max-w-[150px] truncate" title={txn.clientName}>
                          {txn.clientName}
                        </td>
                        <td className="px-4 py-3 text-sm">{formatDate(txn.transactionDate)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded ${
                            txn.transactionType === 'DEPOSIT'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {txn.transactionType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium">
                          {formatCurrency(txn.amount)}
                        </td>
                        <td className="px-4 py-3">
                          {reviewingTransaction?.id === txn.id ? (
                            <select
                              value={selectedReviewTag}
                              onChange={(e) => setSelectedReviewTag(e.target.value as VarianceReviewTag)}
                              className="text-xs px-2 py-1 border border-gray-300 rounded"
                              autoFocus
                            >
                              <option value="">Select tag...</option>
                              {VARIANCE_REVIEW_TAGS.map((tag) => (
                                <option key={tag.value} value={tag.value}>
                                  {tag.label}
                                </option>
                              ))}
                            </select>
                          ) : txn.reviewTag ? (
                            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                              {VARIANCE_REVIEW_TAGS.find(t => t.value === txn.reviewTag)?.label || txn.reviewTag}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Not reviewed</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {reviewingTransaction?.id === txn.id ? (
                            <input
                              type="text"
                              value={reviewNotes}
                              onChange={(e) => setReviewNotes(e.target.value)}
                              placeholder="Add notes..."
                              className="text-xs px-2 py-1 border border-gray-300 rounded w-full"
                            />
                          ) : txn.reviewNotes ? (
                            <span className="text-xs text-gray-600 max-w-[150px] truncate block" title={txn.reviewNotes}>
                              {txn.reviewNotes}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {reviewingTransaction?.id === txn.id ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => {
                                  if (selectedReviewTag) {
                                    handleReviewTransaction(txn.id, txn.transactionSource, selectedReviewTag, reviewNotes);
                                  }
                                }}
                                disabled={!selectedReviewTag}
                                className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setReviewingTransaction(null);
                                  setSelectedReviewTag('');
                                  setReviewNotes('');
                                }}
                                className="text-xs px-2 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setReviewingTransaction({ id: txn.id, type: txn.transactionSource });
                                setSelectedReviewTag(txn.reviewTag || '');
                                setReviewNotes(txn.reviewNotes || '');
                              }}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              {txn.reviewTag ? 'Edit' : 'Review'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Variance Pagination */}
              {variancePagination.totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                  <p className="text-sm text-gray-700">
                    Showing {((variancePagination.page - 1) * variancePagination.limit) + 1} to{" "}
                    {Math.min(variancePagination.page * variancePagination.limit, variancePagination.total)} of{" "}
                    {variancePagination.total} transactions
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fetchVarianceData(variancePagination.page - 1)}
                      disabled={variancePagination.page === 1}
                      className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm text-gray-700">
                      Page {variancePagination.page} of {variancePagination.totalPages}
                    </span>
                    <button
                      onClick={() => fetchVarianceData(variancePagination.page + 1)}
                      disabled={variancePagination.page === variancePagination.totalPages}
                      className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State - Variance Tab */}
          {!loading && varianceData.length === 0 && (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <CheckCircle2 className="h-16 w-16 text-green-400 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No variance transactions found</p>
              <p className="text-gray-500 text-sm mt-2">
                All transactions are matched or no transactions in the selected date range
              </p>
            </div>
          )}
        </>
      )}

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-medium mb-2">Smart Matching Algorithm:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Pass 1 (Exact):</strong> Match by Goal Number + Transaction ID</li>
          <li><strong>Pass 2 (Amount):</strong> Match by amount within ±30 days (if transactionId doesn't match)</li>
          <li><strong>Pass 3 (Split):</strong> Detect split transactions (N bank → 1 fund or N fund → 1 bank) on same day</li>
        </ul>
        <p className="mt-2">
          <strong>Tolerance:</strong> 1% of amount or UGX 1,000 (whichever is greater)
        </p>
        <p className="mt-1">
          Click on a goal row to see detailed transaction matching.
        </p>
      </div>

      {/* Smart Matching Results Modal */}
      {showMatchingResult && matchingResult && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={() => setShowMatchingResult(false)}
            />

            {/* Modal */}
            <div className="relative inline-block w-full max-w-lg p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Smart Matching Results
                </h3>
                <button
                  onClick={() => setShowMatchingResult(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Summary */}
                <div className="p-3 bg-gray-100 rounded-lg text-center">
                  <p className="text-sm text-gray-600">
                    Goals Processed in This Batch (max {batchSize.toLocaleString()})
                  </p>
                  <p className="text-3xl font-bold text-gray-900">
                    {matchingResult.goalsInBatch.toLocaleString()}
                  </p>
                  {matchingResult.hasMore && (
                    <p className="text-sm text-orange-600 mt-1">
                      {(matchingResult.totalGoals - matchingResult.processedGoals).toLocaleString()} goals remaining - click "Continue" to process more
                    </p>
                  )}
                  {!matchingResult.hasMore && (
                    <p className="text-sm text-green-600 mt-1">
                      All {matchingResult.totalGoals.toLocaleString()} goals processed!
                    </p>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-purple-600 h-2.5 rounded-full transition-all"
                    style={{
                      width: `${Math.round((matchingResult.processedGoals / matchingResult.totalGoals) * 100)}%`,
                    }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 text-center">
                  {matchingResult.processedGoals.toLocaleString()} / {matchingResult.totalGoals.toLocaleString()} goals processed
                </p>

                {/* Results Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-sm font-medium text-green-700">Exact Matches</p>
                    <p className="text-2xl font-bold text-green-700">
                      {matchingResult.matchBreakdown.exact}
                    </p>
                    <p className="text-xs text-green-600 mt-1">Goal + Transaction ID match</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-700">Amount Matches</p>
                    <p className="text-2xl font-bold text-blue-700">
                      {matchingResult.matchBreakdown.amount}
                    </p>
                    <p className="text-xs text-blue-600 mt-1">Amount within ±30 days</p>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <p className="text-sm font-medium text-purple-700">Split Matches</p>
                    <p className="text-2xl font-bold text-purple-700">
                      {matchingResult.matchBreakdown.split}
                    </p>
                    <p className="text-xs text-purple-600 mt-1">N:1 or 1:N transactions</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-700">Total Updated</p>
                    <p className="text-2xl font-bold text-gray-700">
                      {matchingResult.totalUpdated}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Transactions status updated</p>
                  </div>
                </div>

                {/* Goals with matches */}
                <div className="p-3 bg-gray-50 rounded-lg text-sm">
                  <p className="font-medium text-gray-700 mb-1">Batch Summary:</p>
                  <ul className="text-gray-600 list-disc list-inside space-y-1">
                    <li>Goals with matches: {matchingResult.goalsWithMatches} / {matchingResult.goalsInBatch}</li>
                    <li>Total matches found: {matchingResult.totalMatches}</li>
                    <li>Date range: {matchingResult.dateRange.startDate} to {matchingResult.dateRange.endDate}</li>
                  </ul>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowMatchingResult(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Close
                </button>
                {matchingResult.hasMore && (
                  <button
                    onClick={handleContinueMatching}
                    disabled={runningMatching}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
                  >
                    {runningMatching ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                        Processing...
                      </>
                    ) : (
                      `Continue (${(matchingResult.totalGoals - matchingResult.processedGoals).toLocaleString()} remaining)`
                    )}
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

export default GoalComparison;
