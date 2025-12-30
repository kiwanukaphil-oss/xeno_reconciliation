import { TransactionSource as PrismaTransactionSource } from '@prisma/client';

/**
 * Transaction Sources
 * Valid sources for fund transactions
 * Note: This list should match the Prisma TransactionSource enum
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
  'RT_Adjustment',
] as const;

// Re-export Prisma's TransactionSource for convenience
export type TransactionSource = PrismaTransactionSource;

/**
 * Validates if a source is valid
 * Accepts null (for missing/empty sources) or TransactionSource enum value
 */
export function isValidTransactionSource(source: PrismaTransactionSource | null): source is PrismaTransactionSource {
  // If source is null, it's not valid (but may be acceptable for historical data)
  if (source === null) {
    return false;
  }
  // If it's a valid Prisma enum value, it was already validated during parsing
  return true;
}

/**
 * Gets a formatted error message for invalid sources
 */
export function getInvalidSourceMessage(source: PrismaTransactionSource | null): string {
  const sourceStr = source === null ? 'null/empty' : String(source);
  return `Invalid transaction source: ${sourceStr}. Valid sources are: ${TRANSACTION_SOURCES.join(', ')}`;
}
