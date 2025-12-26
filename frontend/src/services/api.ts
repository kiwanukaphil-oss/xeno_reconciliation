// XENO Reconciliation API Service Layer
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const handleResponse = async (response: Response) => {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "An unknown error occurred");
  }
  return data;
};

// Fund Upload APIs
export const downloadTemplate = async () => {
  const response = await fetch(`${API_URL}/api/fund-upload/template`);
  if (!response.ok) {
    throw new Error("Failed to download template");
  }
  return response.blob();
};

export const uploadFundFile = async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/fund-upload/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
};

export const getBatchStatus = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches/${batchId}/status`);
  return handleResponse(response);
};

export const getBatchSummary = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches/${batchId}/summary`);
  return handleResponse(response);
};

export const getNewEntities = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches/${batchId}/new-entities`);
  return handleResponse(response);
};

export const approveEntities = async (batchId: string, approvals: any) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches/${batchId}/approve-entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(approvals),
  });
  return handleResponse(response);
};

export const cancelBatch = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches/${batchId}/cancel`, {
    method: "POST",
  });
  return handleResponse(response);
};

export const rollbackBatch = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches/${batchId}/rollback`, {
    method: "DELETE",
  });
  return handleResponse(response);
};

export const getAllBatches = async (page: number = 1, limit: number = 20) => {
  const response = await fetch(`${API_URL}/api/fund-upload/batches?page=${page}&limit=${limit}`);
  return handleResponse(response);
};

// Goal Transactions APIs
export const fetchGoalTransactions = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/goal-transactions?${params}`);
  return handleResponse(response);
};

export const fetchGoalTransactionDetails = async (goalTransactionCode: string) => {
  const response = await fetch(`${API_URL}/api/goal-transactions/${goalTransactionCode}`);
  return handleResponse(response);
};

export const exportGoalTransactionsCSV = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/goal-transactions/export/csv?${params}`);
  if (!response.ok) {
    throw new Error("Failed to export CSV");
  }
  return response.blob();
};

// Fund Transactions APIs
export const fetchFundTransactions = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/fund-transactions?${params}`);
  return handleResponse(response);
};

export const fetchFundTransactionDetails = async (id: string) => {
  const response = await fetch(`${API_URL}/api/fund-transactions/${id}`);
  return handleResponse(response);
};

export const fetchFundTransactionSummary = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/fund-transactions/summary?${params}`);
  return handleResponse(response);
};

// Master Data APIs
export const fetchClients = async () => {
  const response = await fetch(`${API_URL}/api/clients`);
  return handleResponse(response);
};

export const fetchAccounts = async () => {
  const response = await fetch(`${API_URL}/api/accounts`);
  return handleResponse(response);
};

export const fetchGoals = async () => {
  const response = await fetch(`${API_URL}/api/goals`);
  return handleResponse(response);
};

export const fetchFunds = async () => {
  const response = await fetch(`${API_URL}/api/funds`);
  return handleResponse(response);
};

// Fund Price APIs
export const uploadFundPrices = async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/fund-prices/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
};

export const fetchFundPrices = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/fund-prices?${params}`);
  return handleResponse(response);
};

export const fetchLatestFundPrices = async () => {
  const response = await fetch(`${API_URL}/api/fund-prices/latest`);
  return handleResponse(response);
};

export const fetchFundPriceByDate = async (fundCode: string, date: string) => {
  const response = await fetch(`${API_URL}/api/fund-prices/${fundCode}/${date}`);
  return handleResponse(response);
};

export const deleteFundPrice = async (id: string) => {
  const response = await fetch(`${API_URL}/api/fund-prices/${id}`, {
    method: "DELETE",
  });
  return handleResponse(response);
};

export const downloadFundPriceTemplate = async () => {
  const response = await fetch(`${API_URL}/api/fund-prices/template/download`);
  if (!response.ok) {
    throw new Error("Failed to download template");
  }
  return response.blob();
};

// Unit Registry APIs
export const fetchUnitRegistry = async (
  search: string = "",
  showOnlyFunded: boolean = true,
  fundedThreshold: number = 5000,
  limit: number = 100,
  offset: number = 0,
  accountType: string = "",
  accountCategory: string = "",
  asOfDate: string = ""
) => {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  // Only send showOnlyFunded if false (default is true on backend)
  if (!showOnlyFunded) params.append("showOnlyFunded", "false");
  if (fundedThreshold !== 5000) params.append("fundedThreshold", fundedThreshold.toString());
  if (accountType) params.append("accountType", accountType);
  if (accountCategory) params.append("accountCategory", accountCategory);
  if (asOfDate) params.append("asOfDate", asOfDate);
  params.append("limit", limit.toString());
  params.append("offset", offset.toString());

  const response = await fetch(`${API_URL}/api/unit-registry?${params}`);
  return handleResponse(response);
};

export const fetchAccountGoalBreakdown = async (
  accountId: string,
  asOfDate: string = ""
) => {
  const params = new URLSearchParams();
  if (asOfDate) params.append("asOfDate", asOfDate);

  const response = await fetch(`${API_URL}/api/unit-registry/accounts/${accountId}/goals?${params}`);
  return handleResponse(response);
};

// Dashboard APIs
export const fetchDashboardMetrics = async () => {
  const response = await fetch(`${API_URL}/api/dashboard/metrics`);
  return handleResponse(response);
};

// Bank Reconciliation APIs
export const uploadBankFile = async (file: File, uploadedBy: string, metadata?: any) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("uploadedBy", uploadedBy);
  if (metadata) {
    formData.append("metadata", JSON.stringify(metadata));
  }

  const response = await fetch(`${API_URL}/api/bank-reconciliation/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
};

export const getAllBankBatches = async (limit: number = 50, offset: number = 0) => {
  const response = await fetch(`${API_URL}/api/bank-reconciliation/batches?limit=${limit}&offset=${offset}`);
  return handleResponse(response);
};

export const getBankBatchStatus = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-reconciliation/batches/${batchId}/status`);
  return handleResponse(response);
};

export const getBankBatchSummary = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-reconciliation/batches/${batchId}/summary`);
  return handleResponse(response);
};

export const getReconciliationVariances = async (
  limit: number = 50,
  offset: number = 0,
  severity?: string,
  status?: string
) => {
  const params = new URLSearchParams();
  params.append("limit", limit.toString());
  params.append("offset", offset.toString());
  if (severity) params.append("severity", severity);
  if (status) params.append("status", status);

  const response = await fetch(`${API_URL}/api/bank-reconciliation/variances?${params}`);
  return handleResponse(response);
};

export const resolveVariance = async (
  varianceId: string,
  resolutionStatus: string,
  resolutionNotes: string,
  resolvedBy: string
) => {
  const response = await fetch(`${API_URL}/api/bank-reconciliation/variances/${varianceId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resolutionStatus,
      resolutionNotes,
      resolvedBy,
    }),
  });
  return handleResponse(response);
};

// =============================================================================
// NEW Bank Upload APIs (mirrors Fund Upload pattern)
// =============================================================================

export const downloadBankTemplate = async () => {
  const response = await fetch(`${API_URL}/api/bank-upload/template`);
  if (!response.ok) {
    throw new Error("Failed to download template");
  }
  return response.blob();
};

export const uploadBankTransactionFile = async (file: File, uploadedBy: string = "user", metadata?: any) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("uploadedBy", uploadedBy);
  if (metadata) {
    formData.append("metadata", JSON.stringify(metadata));
  }

  const response = await fetch(`${API_URL}/api/bank-upload/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
};

export const getBankUploadBatchStatus = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-upload/batches/${batchId}/status`);
  return handleResponse(response);
};

export const getBankUploadBatchSummary = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-upload/batches/${batchId}/summary`);
  return handleResponse(response);
};

export const getAllBankUploadBatches = async (page: number = 1, limit: number = 20) => {
  const response = await fetch(`${API_URL}/api/bank-upload/batches?page=${page}&limit=${limit}`);
  return handleResponse(response);
};

export const cancelBankUploadBatch = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-upload/batches/${batchId}/cancel`, {
    method: "POST",
  });
  return handleResponse(response);
};

export const rollbackBankUploadBatch = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-upload/batches/${batchId}/rollback`, {
    method: "DELETE",
  });
  return handleResponse(response);
};

export const getBankUploadTransactions = async (batchId: string) => {
  const response = await fetch(`${API_URL}/api/bank-upload/batches/${batchId}/transactions`);
  return handleResponse(response);
};

export const fetchBankTransactions = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/bank-upload/transactions?${params.toString()}`);
  return handleResponse(response);
};

export const exportBankTransactionsCSV = async (params: URLSearchParams) => {
  const response = await fetch(`${API_URL}/api/bank-upload/transactions/export?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to export transactions");
  }
  return response.blob();
};

export const getBankTransactionById = async (transactionId: string) => {
  const response = await fetch(`${API_URL}/api/bank-upload/transactions/${transactionId}`);
  return handleResponse(response);
};

export const updateBankTransactionStatus = async (
  transactionId: string,
  status: string,
  notes?: string,
  updatedBy?: string
) => {
  const response = await fetch(`${API_URL}/api/bank-upload/transactions/${transactionId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      notes,
      updatedBy: updatedBy || "user",
    }),
  });
  return handleResponse(response);
};

export const bulkUpdateBankTransactionStatus = async (
  transactionIds: string[],
  status: string,
  notes?: string,
  updatedBy?: string
) => {
  const response = await fetch(`${API_URL}/api/bank-upload/transactions/bulk-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionIds,
      status,
      notes,
      updatedBy: updatedBy || "user",
    }),
  });
  return handleResponse(response);
};

export const runBankReconciliation = async (transactionIds?: string[], batchSize: number = 2000) => {
  const response = await fetch(`${API_URL}/api/bank-upload/reconciliation/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionIds, batchSize }),
  });
  return handleResponse(response);
};

export const getBankReconciliationStats = async () => {
  const response = await fetch(`${API_URL}/api/bank-upload/reconciliation/stats`);
  return handleResponse(response);
};

// Transaction Comparison API
export const fetchTransactionComparison = async (params: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  accountNumber?: string;
  clientSearch?: string;
  matchStatus?: string;
  page?: number;
  limit?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.accountNumber) queryParams.append("accountNumber", params.accountNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.matchStatus) queryParams.append("matchStatus", params.matchStatus);
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const response = await fetch(`${API_URL}/api/bank-upload/comparison?${queryParams}`);
  return handleResponse(response);
};

export const exportTransactionComparisonCSV = async (params: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  accountNumber?: string;
  clientSearch?: string;
  matchStatus?: string;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.accountNumber) queryParams.append("accountNumber", params.accountNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.matchStatus) queryParams.append("matchStatus", params.matchStatus);

  const response = await fetch(`${API_URL}/api/bank-upload/comparison/export?${queryParams}`);
  if (!response.ok) {
    throw new Error("Failed to export comparison data");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transaction_comparison_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

// =============================================================================
// Goal Comparison APIs (Smart Matching)
// =============================================================================

export const fetchGoalComparison = async (params: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  accountNumber?: string;
  clientSearch?: string;
  status?: string;
  page?: number;
  limit?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.accountNumber) queryParams.append("accountNumber", params.accountNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.status) queryParams.append("status", params.status);
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const response = await fetch(`${API_URL}/api/goal-comparison?${queryParams}`);
  return handleResponse(response);
};

export const fetchGoalTransactionsWithMatching = async (
  goalNumber: string,
  params: {
    startDate?: string;
    endDate?: string;
    transactionType?: string;
  }
) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.transactionType) queryParams.append("transactionType", params.transactionType);

  const response = await fetch(`${API_URL}/api/goal-comparison/${encodeURIComponent(goalNumber)}/transactions?${queryParams}`);
  return handleResponse(response);
};

export const exportGoalComparisonCSV = async (params: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  accountNumber?: string;
  clientSearch?: string;
  status?: string;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.accountNumber) queryParams.append("accountNumber", params.accountNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.status) queryParams.append("status", params.status);

  const response = await fetch(`${API_URL}/api/goal-comparison/export/csv?${queryParams}`);
  if (!response.ok) {
    throw new Error("Failed to export goal comparison data");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `goal_comparison_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

export interface SmartMatchingResult {
  success: boolean;
  message: string;
  totalGoals: number;
  processedGoals: number;
  goalsInBatch: number;
  goalsWithMatches: number;
  hasMore: boolean;
  nextOffset: number | null;
  totalMatches: number;
  totalUpdated: number;
  matchBreakdown: {
    exact: number;
    amount: number;
    split: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
  results: { goalNumber: string; matches: number; updated: number }[];
}

export const runSmartMatching = async (params: {
  startDate?: string;
  endDate?: string;
  applyUpdates?: boolean;
  batchSize?: number;
  offset?: number;
}): Promise<SmartMatchingResult> => {
  const response = await fetch(`${API_URL}/api/goal-comparison/run-matching`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
};

export const applyGoalMatches = async (
  goalNumber: string,
  params: {
    startDate?: string;
    endDate?: string;
    transactionType?: string;
  }
) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.transactionType) queryParams.append("transactionType", params.transactionType);

  const response = await fetch(`${API_URL}/api/goal-comparison/${encodeURIComponent(goalNumber)}/apply-matches?${queryParams}`, {
    method: "POST",
  });
  return handleResponse(response);
};

// =============================================================================
// Fund Comparison APIs (Per-Fund NET Amounts)
// =============================================================================

export interface FundComparisonRow {
  goalNumber: string;
  clientName: string;
  accountNumber: string;
  bankXUMMF: number;
  bankXUBF: number;
  bankXUDEF: number;
  bankXUREF: number;
  bankTotal: number;
  goalXUMMF: number;
  goalXUBF: number;
  goalXUDEF: number;
  goalXUREF: number;
  goalTotal: number;
  xummfVariance: number;
  xubfVariance: number;
  xudefVariance: number;
  xurefVariance: number;
  totalVariance: number;
  status: 'MATCHED' | 'VARIANCE';
}

export interface FundComparisonAggregates {
  totalBankXUMMF: number;
  totalGoalXUMMF: number;
  xummfVariance: number;
  totalBankXUBF: number;
  totalGoalXUBF: number;
  xubfVariance: number;
  totalBankXUDEF: number;
  totalGoalXUDEF: number;
  xudefVariance: number;
  totalBankXUREF: number;
  totalGoalXUREF: number;
  xurefVariance: number;
  totalBankAmount: number;
  totalGoalAmount: number;
  totalVariance: number;
  matchedCount: number;
  varianceCount: number;
  matchRate: number;
}

export interface FundComparisonResponse {
  success: boolean;
  data: FundComparisonRow[];
  aggregates: FundComparisonAggregates;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

export const fetchFundComparison = async (params: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  accountNumber?: string;
  clientSearch?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<FundComparisonResponse> => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.accountNumber) queryParams.append("accountNumber", params.accountNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.status) queryParams.append("status", params.status);
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const response = await fetch(`${API_URL}/api/goal-comparison/fund-summary?${queryParams}`);
  return handleResponse(response);
};

export const exportFundComparisonCSV = async (params: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  accountNumber?: string;
  clientSearch?: string;
  status?: string;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.accountNumber) queryParams.append("accountNumber", params.accountNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.status) queryParams.append("status", params.status);

  const response = await fetch(`${API_URL}/api/goal-comparison/fund-summary/export/csv?${queryParams}`);
  if (!response.ok) {
    throw new Error("Failed to export fund comparison data");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fund_comparison_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

// ============================================================================
// VARIANCE REVIEW API
// ============================================================================

export const VARIANCE_REVIEW_TAGS = [
  { value: 'DUPLICATE_TRANSACTION', label: 'Duplicate Transaction' },
  { value: 'NO_ACTION_NEEDED', label: 'No Action Needed' },
  { value: 'MISSING_IN_BANK', label: 'Missing in Bank' },
  { value: 'MISSING_IN_GOAL', label: 'Missing in Goal' },
  { value: 'TIMING_DIFFERENCE', label: 'Timing Difference' },
  { value: 'AMOUNT_DISCREPANCY', label: 'Amount Discrepancy' },
  { value: 'DATA_ENTRY_ERROR', label: 'Data Entry Error' },
  { value: 'UNDER_INVESTIGATION', label: 'Under Investigation' },
  { value: 'REVERSAL_NETTED', label: 'Reversal (Net Zero)' },
] as const;

export type VarianceReviewTag = typeof VARIANCE_REVIEW_TAGS[number]['value'];

export interface VarianceTransaction {
  transactionSource: 'BANK' | 'GOAL';
  id: string;
  goalNumber: string;
  clientName: string;
  accountNumber: string;
  transactionDate: string;
  transactionType: string;
  amount: number;
  fundCode: string | null;
  sourceTransactionId: string | null;
  reviewTag: VarianceReviewTag | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface VarianceTransactionsSummary {
  totalUnmatched: number;
  pendingReview: number;
  reviewed: number;
  byTag: Record<string, number>;
}

export interface VarianceTransactionsResponse {
  success: boolean;
  data: VarianceTransaction[];
  summary: VarianceTransactionsSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

export interface GoalReviewStatus {
  goalNumber: string;
  status: 'PENDING' | 'PARTIALLY_REVIEWED' | 'FULLY_REVIEWED' | 'NO_VARIANCES';
  totalUnmatched: number;
  reviewedCount: number;
  pendingCount: number;
  byTag: Record<string, number>;
}

export const reviewBankTransaction = async (
  transactionId: string,
  reviewTag: VarianceReviewTag,
  reviewNotes: string | null,
  reviewedBy: string
): Promise<{ success: boolean; transaction: unknown }> => {
  const response = await fetch(
    `${API_URL}/api/goal-comparison/bank-transactions/${transactionId}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewTag, reviewNotes, reviewedBy }),
    }
  );
  return handleResponse(response);
};

export const reviewGoalTransaction = async (
  goalTransactionCode: string,
  reviewTag: VarianceReviewTag,
  reviewNotes: string | null,
  reviewedBy: string
): Promise<{ success: boolean; updatedCount: number }> => {
  const response = await fetch(
    `${API_URL}/api/goal-comparison/goal-transactions/${encodeURIComponent(goalTransactionCode)}/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewTag, reviewNotes, reviewedBy }),
    }
  );
  return handleResponse(response);
};

export const bulkReviewTransactions = async (params: {
  bankTransactionIds?: string[];
  goalTransactionCodes?: string[];
  reviewTag: VarianceReviewTag;
  reviewNotes: string | null;
  reviewedBy: string;
}): Promise<{ success: boolean; updated: { bank: number; goal: number } }> => {
  const response = await fetch(`${API_URL}/api/goal-comparison/review/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
};

// Manual matching - link bank transactions to goal transactions
export const createManualMatch = async (params: {
  bankTransactionIds: string[];
  goalTransactionCodes: string[];
  matchedBy: string;
}): Promise<{
  success: boolean;
  matchedBankCount: number;
  matchedGoalCount: number;
  bankTotal: number;
  goalTotal: number;
}> => {
  const response = await fetch(`${API_URL}/api/goal-comparison/manual-match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
};

// Unmatch - remove a manual match
export const removeManualMatch = async (params: {
  bankTransactionIds?: string[];
  goalTransactionCodes?: string[];
}): Promise<{ success: boolean; unmatched: number }> => {
  const response = await fetch(`${API_URL}/api/goal-comparison/manual-match`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
};

export const fetchGoalReviewStatus = async (
  goalNumber: string,
  startDate?: string,
  endDate?: string
): Promise<GoalReviewStatus> => {
  const queryParams = new URLSearchParams();
  if (startDate) queryParams.append("startDate", startDate);
  if (endDate) queryParams.append("endDate", endDate);

  const response = await fetch(
    `${API_URL}/api/goal-comparison/${encodeURIComponent(goalNumber)}/review-status?${queryParams}`
  );
  return handleResponse(response);
};

export const fetchVarianceTransactions = async (params: {
  startDate?: string;
  endDate?: string;
  reviewStatus?: 'PENDING' | 'REVIEWED' | 'ALL';
  reviewTag?: string;
  goalNumber?: string;
  clientSearch?: string;
  page?: number;
  limit?: number;
}): Promise<VarianceTransactionsResponse> => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.reviewStatus) queryParams.append("reviewStatus", params.reviewStatus);
  if (params.reviewTag) queryParams.append("reviewTag", params.reviewTag);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const response = await fetch(`${API_URL}/api/goal-comparison/variance-transactions?${queryParams}`);
  return handleResponse(response);
};

export const exportVarianceTransactionsExcel = async (params: {
  startDate?: string;
  endDate?: string;
  reviewStatus?: 'PENDING' | 'REVIEWED' | 'ALL';
  reviewTag?: string;
  goalNumber?: string;
  clientSearch?: string;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.reviewStatus) queryParams.append("reviewStatus", params.reviewStatus);
  if (params.reviewTag) queryParams.append("reviewTag", params.reviewTag);
  if (params.goalNumber) queryParams.append("goalNumber", params.goalNumber);
  if (params.clientSearch) queryParams.append("clientSearch", params.clientSearch);

  const response = await fetch(`${API_URL}/api/goal-comparison/variance-transactions/export?${queryParams}`);
  if (!response.ok) {
    throw new Error("Failed to export variance transactions");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `variance_review_${params.startDate || 'all'}_to_${params.endDate || 'all'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

// ============================================================================
// REVERSAL LINKING API
// ============================================================================

export interface ReversalCandidate {
  id: string;
  transactionId: string;
  transactionDate: string;
  transactionType: string;
  totalAmount: number;
  goalNumber: string;
  clientName: string;
  accountNumber: string;
  reviewTag: string | null;
  reviewNotes: string | null;
}

export interface ReversalCandidatesResponse {
  success: boolean;
  sourceTransaction: ReversalCandidate;
  candidates: ReversalCandidate[];
}

// Find potential reversal candidates for a bank transaction
export const findReversalCandidates = async (
  transactionId: string,
  dateRange?: { startDate: string; endDate: string }
): Promise<ReversalCandidatesResponse> => {
  const queryParams = new URLSearchParams();
  if (dateRange?.startDate) queryParams.append("startDate", dateRange.startDate);
  if (dateRange?.endDate) queryParams.append("endDate", dateRange.endDate);

  const response = await fetch(
    `${API_URL}/api/goal-comparison/reversal-candidates/${encodeURIComponent(transactionId)}?${queryParams}`
  );
  return handleResponse(response);
};

// Link two bank transactions as a reversal pair
export const linkReversal = async (params: {
  transactionId1: string;
  transactionId2: string;
  linkedBy: string;
}): Promise<{
  success: boolean;
  message: string;
  transaction1: { id: string; transactionType: string; totalAmount: number };
  transaction2: { id: string; transactionType: string; totalAmount: number };
}> => {
  const response = await fetch(`${API_URL}/api/goal-comparison/link-reversal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse(response);
};

// Unlink a reversal pair
export const unlinkReversal = async (
  transactionId: string
): Promise<{
  success: boolean;
  message: string;
  unlinkedCount: number;
}> => {
  const response = await fetch(
    `${API_URL}/api/goal-comparison/unlink-reversal/${encodeURIComponent(transactionId)}`,
    { method: 'DELETE' }
  );
  return handleResponse(response);
};

// Get reversal pair info for a transaction
export const getReversalPairInfo = async (
  transactionId: string
): Promise<{
  success: boolean;
  isReversalPair: boolean;
  pairedTransaction: ReversalCandidate | null;
}> => {
  const response = await fetch(
    `${API_URL}/api/goal-comparison/reversal-info/${encodeURIComponent(transactionId)}`
  );
  return handleResponse(response);
};
