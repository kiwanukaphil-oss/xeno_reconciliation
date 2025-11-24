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
  accountCategory: string = ""
) => {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  // Only send showOnlyFunded if false (default is true on backend)
  if (!showOnlyFunded) params.append("showOnlyFunded", "false");
  if (fundedThreshold !== 5000) params.append("fundedThreshold", fundedThreshold.toString());
  if (accountType) params.append("accountType", accountType);
  if (accountCategory) params.append("accountCategory", accountCategory);
  params.append("limit", limit.toString());
  params.append("offset", offset.toString());

  const response = await fetch(`${API_URL}/api/unit-registry?${params}`);
  return handleResponse(response);
};
