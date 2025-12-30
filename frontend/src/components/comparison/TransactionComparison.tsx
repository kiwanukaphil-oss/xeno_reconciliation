import { useState, useEffect } from "react";
import {
  Scale,
  Search,
  Calendar,
  Download,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Tag,
  Building2,
  FileText,
} from "lucide-react";
import {
  fetchVarianceTransactions,
  exportVarianceTransactionsExcel,
  reviewBankTransaction,
  reviewGoalTransaction,
  VARIANCE_REVIEW_TAGS,
} from "../../services/api";
import type {
  VarianceTransaction,
  VarianceTransactionsSummary,
} from "../../services/api";

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type TabType = "GOAL" | "BANK";

const TransactionComparison = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>("GOAL");

  // Data state
  const [data, setData] = useState<VarianceTransaction[]>([]);
  const [summary, setSummary] = useState<VarianceTransactionsSummary | null>(null);
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
  const [clientSearch, setClientSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"ALL" | "PENDING" | "REVIEWED">("ALL");

  // Tagging state
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [tagNotes, setTagNotes] = useState<string>("");
  const [savingTag, setSavingTag] = useState(false);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVarianceTransactions({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        clientSearch: clientSearch || undefined,
        reviewStatus: reviewStatus !== "ALL" ? reviewStatus : undefined,
        transactionSource: activeTab,
        page,
        limit: pagination.limit,
      });
      setData(result.data);
      setSummary(result.summary);
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
    setClientSearch("");
    setReviewStatus("ALL");
    setTimeout(() => fetchData(1), 0);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportVarianceTransactionsExcel({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        goalNumber: goalNumber || undefined,
        clientSearch: clientSearch || undefined,
        reviewStatus: reviewStatus !== "ALL" ? reviewStatus : undefined,
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

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setPagination({ ...pagination, page: 1 });
  };

  const handleTagClick = (txn: VarianceTransaction) => {
    setTaggingId(txn.id);
    setSelectedTag(txn.reviewTag || "");
    setTagNotes(txn.reviewNotes || "");
  };

  const handleSaveTag = async () => {
    if (!taggingId || !selectedTag) return;

    setSavingTag(true);
    try {
      const txn = data.find((t) => t.id === taggingId);
      if (!txn) return;

      if (txn.transactionSource === "BANK") {
        await reviewBankTransaction(
          taggingId,
          selectedTag as Parameters<typeof reviewBankTransaction>[1],
          tagNotes || null,
          "System"
        );
      } else {
        await reviewGoalTransaction(
          taggingId,
          selectedTag as Parameters<typeof reviewGoalTransaction>[1],
          tagNotes || null,
          "System"
        );
      }

      // Refresh data
      fetchData(pagination.page);
      setTaggingId(null);
      setSelectedTag("");
      setTagNotes("");
    } catch (err) {
      alert("Failed to save tag: " + (err as Error).message);
    } finally {
      setSavingTag(false);
    }
  };

  const handleCancelTag = () => {
    setTaggingId(null);
    setSelectedTag("");
    setTagNotes("");
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

  const getTagBadgeClass = (tag: string | null) => {
    if (!tag) return "";
    const tagColors: Record<string, string> = {
      DUPLICATE_TRANSACTION: "bg-yellow-100 text-yellow-800",
      NO_ACTION_NEEDED: "bg-green-100 text-green-800",
      MISSING_IN_BANK: "bg-purple-100 text-purple-800",
      MISSING_IN_FUND: "bg-red-100 text-red-800",
      NEEDS_INVESTIGATION: "bg-orange-100 text-orange-800",
      TIMING_DIFFERENCE: "bg-blue-100 text-blue-800",
      AMOUNT_MISMATCH: "bg-pink-100 text-pink-800",
    };
    return tagColors[tag] || "bg-gray-100 text-gray-800";
  };

  const getTagLabel = (tag: string) => {
    const tagObj = VARIANCE_REVIEW_TAGS.find((t) => t.value === tag);
    return tagObj ? tagObj.label : tag.replace(/_/g, " ");
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Scale className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Variance Transactions</h1>
        </div>
        <p className="text-gray-600">
          View unmatched transactions identified by Goal Comparison - same data, no drilldown required
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => handleTabChange("GOAL")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "GOAL"
              ? "border-purple-600 text-purple-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <FileText className="h-4 w-4" />
          Missing in Bank
          {summary && (
            <span
              className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                activeTab === "GOAL" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
              }`}
            >
              {summary.missingInBankCount}
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange("BANK")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "BANK"
              ? "border-red-600 text-red-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <Building2 className="h-4 w-4" />
          Missing in Fund
          {summary && (
            <span
              className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                activeTab === "BANK" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
              }`}
            >
              {summary.missingInFundCount}
            </span>
          )}
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Total Transactions</p>
            <p className="text-2xl font-bold text-gray-900">{pagination.total}</p>
          </div>
          <div className="bg-white border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Pending Review</p>
            <p className="text-2xl font-bold text-yellow-600">{summary.pendingReview}</p>
          </div>
          <div className="bg-white border border-green-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">Reviewed</p>
            <p className="text-2xl font-bold text-green-600">{summary.reviewed}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Goal Number</label>
            <input
              type="text"
              value={goalNumber}
              onChange={(e) => setGoalNumber(e.target.value)}
              placeholder="e.g., 701-123..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Client Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
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

          {/* Review Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Review Status</label>
            <select
              value={reviewStatus}
              onChange={(e) => setReviewStatus(e.target.value as "ALL" | "PENDING" | "REVIEWED")}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending Review</option>
              <option value="REVIEWED">Reviewed</option>
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
            Export Excel
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

      {/* Data Table */}
      {!loading && data.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Goal Number</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Txn ID</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">XUMMF</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">XUBF</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">XUDEF</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">XUREF</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Tag</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.map((txn) => (
                  <tr
                    key={txn.id}
                    className={`hover:bg-gray-50 ${txn.reviewTag ? "bg-yellow-50" : ""}`}
                  >
                    <td className="px-4 py-3 text-sm">{formatDate(txn.transactionDate)}</td>
                    <td className="px-4 py-3 text-sm font-mono">{txn.goalNumber}</td>
                    <td className="px-4 py-3 text-sm font-medium">{txn.clientName}</td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          txn.transactionType === "DEPOSIT"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {txn.transactionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">
                      {txn.sourceTransactionId || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {formatCurrency(txn.xummfAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {formatCurrency(txn.xubfAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {formatCurrency(txn.xudefAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {formatCurrency(txn.xurefAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-bold">
                      {formatCurrency(txn.amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {txn.reviewTag ? (
                        <span className={`px-2 py-0.5 text-xs rounded ${getTagBadgeClass(txn.reviewTag)}`}>
                          {getTagLabel(txn.reviewTag)}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleTagClick(txn)}
                        className="inline-flex items-center px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                      >
                        <Tag className="h-3 w-3 mr-1" />
                        {txn.reviewTag ? "Edit" : "Tag"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-700">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
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
          <p className="text-gray-600 text-lg">No variance transactions found</p>
          <p className="text-gray-500 text-sm mt-2">
            {activeTab === "GOAL"
              ? "All fund transactions have matching bank transactions"
              : "All bank transactions have matching fund transactions"}
          </p>
        </div>
      )}

      {/* Tagging Modal */}
      {taggingId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Review Transaction</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Review Tag</label>
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a tag...</option>
                {VARIANCE_REVIEW_TAGS.map((tag) => (
                  <option key={tag.value} value={tag.value}>
                    {tag.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
              <textarea
                value={tagNotes}
                onChange={(e) => setTagNotes(e.target.value)}
                placeholder="Add any notes about this transaction..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancelTag}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTag}
                disabled={!selectedTag || savingTag}
                className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {savingTag ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save Tag"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-medium mb-1">About Variance Transactions:</p>
        <p>
          <strong>Missing in Bank:</strong> Fund/Goal transactions that exist in the fund system but have no
          corresponding bank transaction. These need investigation.
        </p>
        <p className="mt-1">
          <strong>Missing in Fund:</strong> Bank transactions that exist in bank records but have no
          corresponding fund transaction. These may indicate unprocessed deposits or data issues.
        </p>
        <p className="mt-2 text-xs text-blue-600">
          This view shows the exact same transactions identified in Goal Comparison drilldowns,
          using the same smart matching logic.
        </p>
      </div>
    </div>
  );
};

export default TransactionComparison;
