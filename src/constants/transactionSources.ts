/**
 * Transaction Sources
 * Valid sources for fund transactions
 */
export const TRANSACTION_SOURCES = [
  'Transfer_Reversal',
  'AIRTEL_APP',
  'MTN_USSD',
  'AIRTEL_WEB',
  'MTN_APP',
  'MTN_WEB',
  'BANK',
  'MTN_MOMO',
  'AIRTEL_MONEY',
] as const;

export type TransactionSource = typeof TRANSACTION_SOURCES[number];

/**
 * Validates if a source is valid
 */
export function isValidTransactionSource(source: string): source is TransactionSource {
  return TRANSACTION_SOURCES.includes(source as TransactionSource);
}

/**
 * Gets a formatted error message for invalid sources
 */
export function getInvalidSourceMessage(source: string): string {
  return `Invalid transaction source: ${source}. Valid sources are: ${TRANSACTION_SOURCES.join(', ')}`;
}
