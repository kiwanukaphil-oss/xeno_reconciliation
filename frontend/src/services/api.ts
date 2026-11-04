// XENO Reconciliation API Service Layer
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const handleResponse = async (response: Response) => {
  const data = await response.json();
  if (!response.ok) {
    // Standard API errors carry a readable "message"; "error" is only the error type
    throw new Error(data.message || data.error || "An unknown error occurred");
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

// Client Insights APIs (profile-based AUM composition, data quality, impact pack)
export type InsightSegment = "INDIVIDUAL" | "INSTITUTIONAL" | "ALL";

/** IDENTIFIED = declared gender only; ALLOCATED = all clients, unidentified split in the known ratio. */
export type GenderView = "IDENTIFIED" | "ALLOCATED";

/** As-at date for Client Insights: YYYY-MM-DD, or null for Latest. */
export type InsightAsOf = string | null;

export type SnapshotStatus = "NOT_BUILT" | "BUILDING" | "READY" | "STALE" | "FAILED";

export interface SnapshotDateInfo {
  asOf: string;
  status: SnapshotStatus;
  isPeriodEnd: boolean;
  builtAt: string | null;
  buildMs: number | null;
  accountRows: number | null;
  priceAsOf: string | null;
  error: string | null;
}

export interface InsightAsOfDates {
  latest: { transactions: string; prices: string | null };
  dates: SnapshotDateInfo[];
}

const SNAPSHOT_POLL_MS = 3000;
const SNAPSHOT_MAX_WAIT_MS = 10 * 60 * 1000;

// Pages report "preparing figures as at <date>" through these listeners (the date bar shows it)
type PreparingListener = (asOf: string, preparing: boolean) => void;
const preparingListeners = new Set<PreparingListener>();

/** Subscribes to snapshot preparation start/finish; returns the unsubscribe function. */
export const onInsightSnapshotPreparing = (listener: PreparingListener) => {
  preparingListeners.add(listener);
  return () => {
    preparingListeners.delete(listener);
  };
};

const notifyPreparing = (asOf: string, preparing: boolean) => preparingListeners.forEach((listener) => listener(asOf, preparing));

/** Adds asOf to a Client Insights URL (nothing for Latest). */
const withAsOf = (path: string, asOf: InsightAsOf) => {
  if (!asOf) return `${API_URL}${path}`;
  return `${API_URL}${path}${path.includes("?") ? "&" : "?"}asOf=${asOf}`;
};

const waitFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/**
 * Fetches a Client Insights endpoint for an as-at date. If the server is still preparing that date
 * (HTTP 202), waits until the snapshot is ready, telling listeners meanwhile, then fetches again.
 */
const fetchInsight = async (path: string, asOf: InsightAsOf, signal?: AbortSignal) => {
  const url = withAsOf(path, asOf);
  const first = await fetch(url, { signal });
  if (first.status !== 202 || !asOf) return handleResponse(first);

  notifyPreparing(asOf, true);
  try {
    const started = Date.now();
    for (;;) {
      await waitFor(SNAPSHOT_POLL_MS, signal);
      const snapshot: SnapshotDateInfo = await handleResponse(await fetch(`${API_URL}/api/client-insights/snapshots/${asOf}`, { signal }));
      if (snapshot.status === "READY") break;
      if (snapshot.status === "FAILED") throw new Error(`Figures as at ${asOf} could not be prepared: ${snapshot.error ?? "unknown error"}`);
      if (Date.now() - started > SNAPSHOT_MAX_WAIT_MS) throw new Error(`Figures as at ${asOf} are taking too long to prepare; try again later`);
    }
  } finally {
    notifyPreparing(asOf, false);
  }
  return handleResponse(await fetch(url, { signal }));
};

/** Month-ends and stored dates the as-at selector offers, with each one's status. */
export const fetchInsightAsOfDates = async (): Promise<InsightAsOfDates> => {
  const response = await fetch(`${API_URL}/api/client-insights/as-of-dates`);
  return handleResponse(response);
};

export const fetchClientInsightsSummary = async (segment: InsightSegment, genderView: GenderView = "IDENTIFIED", asOf: InsightAsOf = null) =>
  fetchInsight(`/api/client-insights/summary?segment=${segment}&genderView=${genderView}`, asOf);

export const fetchProfileDataQuality = async (segment: InsightSegment, limit = 50, asOf: InsightAsOf = null) =>
  fetchInsight(`/api/client-insights/data-quality?segment=${segment}&limit=${limit}`, asOf);

export const fetchRiskAllocation = async (segment: InsightSegment, limit = 50, asOf: InsightAsOf = null, genderView: GenderView = "IDENTIFIED") =>
  fetchInsight(`/api/client-insights/risk-allocation?segment=${segment}&limit=${limit}&genderView=${genderView}`, asOf);

export const fetchSuitabilityReview = async (limit = 50, asOf: InsightAsOf = null) =>
  fetchInsight(`/api/client-insights/suitability?limit=${limit}`, asOf);

export const fetchGroupSchemes = async (asOf: InsightAsOf = null) => fetchInsight(`/api/client-insights/group-schemes`, asOf);

export const fetchImpactPack = async (asOf: InsightAsOf = null) => fetchInsight(`/api/client-insights/impact-pack`, asOf);

export const fetchGoalAchievement = async (segment: InsightSegment, asOf: InsightAsOf = null, genderView: GenderView = "IDENTIFIED") =>
  fetchInsight(`/api/client-insights/goal-achievement?segment=${segment}&genderView=${genderView}`, asOf);

export interface AccountDirectoryQuery {
  search?: string;
  segment?: InsightSegment;
  funded?: "FUNDED" | "UNFUNDED" | "ALL";
  channel?: string;
  gender?: string;
  missing?: string;
  minBalance?: number;
  sort?: "balance" | "name" | "lastDeposit" | "accountNumber";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/** Query string for the account directory, leaving out empty filters. */
const buildAccountDirectoryParams = (query: AccountDirectoryQuery) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  return params.toString();
};

export const fetchAccountProfiles = async (query: AccountDirectoryQuery, signal?: AbortSignal, asOf: InsightAsOf = null) =>
  fetchInsight(`/api/client-insights/accounts?${buildAccountDirectoryParams(query)}`, asOf, signal);

export const fetchAccountProfileDetail = async (accountNumber: string, signal?: AbortSignal, asOf: InsightAsOf = null) =>
  fetchInsight(`/api/client-insights/accounts/${encodeURIComponent(accountNumber)}`, asOf, signal);

/** Export link: the browser downloads the streamed workbook straight to disk, without holding it in memory. */
export const accountProfilesExportUrl = (query: AccountDirectoryQuery, asOf: InsightAsOf = null) => {
  const filters: AccountDirectoryQuery = {
    search: query.search,
    segment: query.segment,
    funded: query.funded,
    channel: query.channel,
    gender: query.gender,
    missing: query.missing,
    minBalance: query.minBalance,
  };
  return withAsOf(`/api/client-insights/accounts/export?${buildAccountDirectoryParams(filters)}`, asOf);
};

export const downloadImpactPack = async (asOf: InsightAsOf = null) => {
  const response = await fetch(withAsOf(`/api/client-insights/impact-pack/export`, asOf));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "Failed to download impact pack");
  }
  return response.blob();
};

// Monthly Metrics (UG) report
export type UgRowKind = "header" | "system" | "formula" | "manual";
export type UgRowFormat = "int" | "ugx" | "pct" | "avg" | "rate";

export interface UgMetricsRow {
  row: number;
  band: string | null;
  label: string;
  /** Stable key of a manual row, under which hand-entered figures are saved. */
  key: string | null;
  kind: UgRowKind;
  format: UgRowFormat | null;
  source: string | null;
  values: Array<number | null>;
}

export interface UgMetricsReport {
  months: Array<{ month: string; periodEnd: string; priceAsOf: string | null; manualUpdatedAt: string | null }>;
  rows: UgMetricsRow[];
  definitions: string[];
  notComputed: Array<{ metric: string; reason: string }>;
}

/**
 * Inputs-UG rows for a range of months (YYYY-MM). While the server prepares month-end figures it
 * answers 202; onPreparing is told, and the request is repeated until the figures are ready.
 */
export const fetchUgMetricsReport = async (
  from: string,
  to: string,
  onPreparing: (preparing: boolean) => void,
  signal?: AbortSignal
): Promise<UgMetricsReport> => {
  const url = `${API_URL}/api/reports/ug-metrics/rows?from=${from}&to=${to}`;
  const started = Date.now();
  try {
    for (;;) {
      const response = await fetch(url, { signal });
      if (response.status !== 202) return handleResponse(response);
      onPreparing(true);
      if (Date.now() - started > SNAPSHOT_MAX_WAIT_MS) throw new Error("Month-end figures are taking too long to prepare; try again later");
      await waitFor(SNAPSHOT_POLL_MS, signal);
    }
  } finally {
    onPreparing(false);
  }
};

/** Saves hand-entered figures for one month (YYYY-MM): a number sets a figure, null clears it. */
export const saveUgManualInputs = async (month: string, values: Record<string, number | null>) => {
  const response = await fetch(`${API_URL}/api/reports/ug-metrics/manual-inputs/${month}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  return handleResponse(response);
};

export const downloadUgMetricsWorkbook = async (from: string, to: string) => {
  const response = await fetch(`${API_URL}/api/reports/ug-metrics/export?from=${from}&to=${to}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "Failed to download the metrics workbook");
  }
  return response.blob();
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
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.search) queryParams.append("search", params.search);
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
  search?: string;
  status?: string;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.search) queryParams.append("search", params.search);
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
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<FundComparisonResponse> => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.search) queryParams.append("search", params.search);
  if (params.status) queryParams.append("status", params.status);
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const response = await fetch(`${API_URL}/api/goal-comparison/fund-summary?${queryParams}`);
  return handleResponse(response);
};

export const exportFundComparisonCSV = async (params: {
  startDate?: string;
  endDate?: string;
  search?: string;
  status?: string;
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.search) queryParams.append("search", params.search);
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

// =============================================================================
// Account-Level Fund Comparison APIs
// =============================================================================

export interface AccountFundComparisonRow {
  accountNumber: string;
  clientName: string;
  goalCount: number;
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
  matchedGoalCount: number;
  varianceGoalCount: number;
}

export interface AccountFundComparisonAggregates {
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
  totalGoalCount: number;
  totalMatchedGoalCount: number;
  totalVarianceGoalCount: number;
}

export interface AccountFundComparisonResponse {
  success: boolean;
  data: AccountFundComparisonRow[];
  aggregates: AccountFundComparisonAggregates;
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

export const fetchAccountFundComparison = async (params: {
  startDate?: string;
  endDate?: string;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<AccountFundComparisonResponse> => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.search) queryParams.append("search", params.search);
  if (params.status) queryParams.append("status", params.status);
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const response = await fetch(`${API_URL}/api/goal-comparison/fund-summary/by-account?${queryParams}`);
  return handleResponse(response);
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
  // 4-fund breakdown
  xummfAmount: number;
  xubfAmount: number;
  xudefAmount: number;
  xurefAmount: number;
  sourceTransactionId: string | null;
  reviewTag: VarianceReviewTag | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  // Resolution tracking fields
  varianceResolved: boolean;
  resolvedAt: string | null;
  resolvedReason: string | null;
}

export interface VarianceTransactionsSummary {
  totalUnmatched: number;
  pendingReview: number;
  reviewed: number;
  byTag: Record<string, number>;
  missingInBankCount: number;  // GOAL transactions (fund exists, no bank)
  missingInFundCount: number;  // BANK transactions (bank exists, no fund)
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
  search?: string;
  resolutionStatus?: 'RESOLVED' | 'PENDING' | 'ALL';
  transactionSource?: 'BANK' | 'GOAL';
  page?: number;
  limit?: number;
}): Promise<VarianceTransactionsResponse> => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.reviewStatus) queryParams.append("reviewStatus", params.reviewStatus);
  if (params.reviewTag) queryParams.append("reviewTag", params.reviewTag);
  if (params.search) queryParams.append("search", params.search);
  if (params.resolutionStatus) queryParams.append("resolutionStatus", params.resolutionStatus);
  if (params.transactionSource) queryParams.append("transactionSource", params.transactionSource);
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
  search?: string;
  resolutionStatus?: 'RESOLVED' | 'PENDING' | 'ALL';
}) => {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.append("startDate", params.startDate);
  if (params.endDate) queryParams.append("endDate", params.endDate);
  if (params.reviewStatus) queryParams.append("reviewStatus", params.reviewStatus);
  if (params.reviewTag) queryParams.append("reviewTag", params.reviewTag);
  if (params.search) queryParams.append("search", params.search);
  if (params.resolutionStatus) queryParams.append("resolutionStatus", params.resolutionStatus);

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

// ============================================================================
// VARIANCE RESOLUTION API
// ============================================================================

export interface VarianceResolutionResult {
  resolved: number;
  byTag: Record<string, number>;
  details: Array<{
    id: string;
    source: 'BANK' | 'GOAL';
    goalNumber: string;
    transactionId: string | null;
    amount: number;
    originalTag: string;
    resolvedReason: string;
  }>;
}

export interface VarianceResolutionStats {
  totalTaggedForResolution: number;
  totalResolved: number;
  pendingResolution: number;
  byTag: Record<string, { total: number; resolved: number; pending: number }>;
}

// Manually trigger variance resolution detection
export const detectResolvedVariances = async (params?: {
  startDate?: string;
  endDate?: string;
  triggeredBy?: string;
}): Promise<{
  success: boolean;
  message: string;
  data: VarianceResolutionResult;
}> => {
  const response = await fetch(`${API_URL}/api/variance-resolution/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  return handleResponse(response);
};

// Get variance resolution statistics
export const getVarianceResolutionStats = async (): Promise<{
  success: boolean;
  data: VarianceResolutionStats;
}> => {
  const response = await fetch(`${API_URL}/api/variance-resolution/stats`);
  return handleResponse(response);
};

// Get resolved variances report
export const getResolvedVariancesReport = async (params?: {
  startDate?: string;
  endDate?: string;
  goalNumber?: string;
  clientSearch?: string;
  originalTag?: string;
}): Promise<{
  success: boolean;
  data: VarianceTransaction[];
  summary: {
    totalResolved: number;
    byTag: Record<string, number>;
    bySource: { bank: number; goal: number };
  };
}> => {
  const queryParams = new URLSearchParams();
  if (params?.startDate) queryParams.append('startDate', params.startDate);
  if (params?.endDate) queryParams.append('endDate', params.endDate);
  if (params?.goalNumber) queryParams.append('goalNumber', params.goalNumber);
  if (params?.clientSearch) queryParams.append('clientSearch', params.clientSearch);
  if (params?.originalTag) queryParams.append('originalTag', params.originalTag);

  const response = await fetch(
    `${API_URL}/api/variance-resolution/report?${queryParams}`
  );
  return handleResponse(response);
};
