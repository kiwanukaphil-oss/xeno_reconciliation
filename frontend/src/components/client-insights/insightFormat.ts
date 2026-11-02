// Formatting shared by the Client Insights, Profile Data Quality and Impact Pack pages

const LABEL_OVERRIDES: Record<string, string> = {
  UNKNOWN: "Unknown",
  MTN: "MTN",
  WEB: "Web",
  APP: "App",
  YOLLO: "Yollo",
  AIRTEL: "Airtel",
  OTHER_UG: "Other Ugandan network",
  FOREIGN: "Foreign number",
  ABROAD: "Abroad",
};

/** "OTHER_UG" -> "Other Ugandan network", "3. 500k - 5m" -> "500k - 5m", "CENTRAL" -> "Central". */
export const formatGroupLabel = (key: string): string => {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  const withoutOrderPrefix = key.replace(/^\d+\.\s/, "");
  // Only rewrite code-style values (e.g. CENTRAL, OTHER_UG); leave prose and amounts as they are
  if (!/^[A-Z][A-Z0-9_]*$/.test(withoutOrderPrefix)) return withoutOrderPrefix;
  const words = withoutOrderPrefix.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const isUnknownGroup = (key: string) =>
  key === "UNKNOWN" || key.startsWith("Other");

export const formatUGX = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "–";
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

/** Short money for tiles and bar labels: UGX 55.2bn, UGX 1.3m, UGX 14,189. */
export const formatUGXCompact = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "–";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `UGX ${(value / 1e9).toFixed(1)}bn`;
  if (abs >= 1e6) return `UGX ${(value / 1e6).toFixed(1)}m`;
  return formatUGX(value);
};

export const formatPct = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined) return "–";
  return `${(value * 100).toFixed(digits)}%`;
};

export const formatCount = (value: number | null | undefined) =>
  value === null || value === undefined ? "–" : Math.round(value).toLocaleString();

export const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleDateString("en-UG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/** Saves a downloaded blob under the given file name. */
export const saveBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};
