import { DateUtils } from '../../../utils/dateUtils';

/**
 * Generates unique codes linking related fund transactions
 *
 * Format for 2024+ transactions (with source tracking):
 *   {YYYY-MM-DD}-{accountNumber}-{goalNumber}-{transactionId}-{source}
 *   Example: "2024-07-24-701-5558635193-701-5558635193a-123456789-BANK"
 *
 * Format for historical transactions (pre-2024, without source tracking):
 *   {YYYY-MM-DD}-{accountNumber}-{goalNumber}
 *   Example: "2018-07-24-701-5558635193-701-5558635193a"
 *
 * The transactionId and source are included (when available) to distinguish between:
 * - Multiple transactions on the same day (e.g., regular vs reversal)
 * - Split disbursements with same bank transaction ID but different payment methods
 *   (e.g., BANK123 distributed via BANK, AIRTEL_MONEY, MTN_MOMO)
 */
export class GoalTransactionCodeGenerator {
  /**
   * Generates a goalTransactionCode from transaction details
   * For historical data, transactionId and source may be empty
   */
  static generate(
    transactionDate: Date | string,
    accountNumber: string,
    goalNumber: string,
    transactionId: string = '',
    source: string = ''
  ): string {
    // Normalize date to YYYY-MM-DD format
    const dateStr =
      typeof transactionDate === 'string'
        ? this.normalizeDate(transactionDate)
        : DateUtils.formatDate(transactionDate);

    // Clean inputs (remove extra spaces)
    const cleanAccount = accountNumber.trim();
    const cleanGoal = goalNumber.trim();
    const cleanTransactionId = (transactionId || '').trim();
    const cleanSource = (source || '').trim();

    // For historical data without source tracking, use shorter format
    if (!cleanTransactionId && !cleanSource) {
      return `${dateStr}-${cleanAccount}-${cleanGoal}`;
    }

    return `${dateStr}-${cleanAccount}-${cleanGoal}-${cleanTransactionId}-${cleanSource}`;
  }

  /**
   * Normalizes a date string to YYYY-MM-DD format
   */
  private static normalizeDate(dateStr: string): string {
    const date = DateUtils.parseDate(dateStr);
    if (!date) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
    return DateUtils.formatDate(date);
  }

  /**
   * Validates if a goalTransactionCode follows the correct format
   * Supports both:
   * - Historical format (pre-2024): YYYY-MM-DD-{accountNumber}-{goalNumber}
   * - New format (2024+): YYYY-MM-DD-{accountNumber}-{goalNumber}-{transactionId}-{source}
   */
  static validate(code: string): boolean {
    const parts = code.split('-');

    // Minimum 5 parts for historical format (YYYY-MM-DD + account parts + goal)
    // Account number like "701-5558635193" has 2 parts, goal like "701-5558635193a" has 2 parts
    if (parts.length < 5) return false;

    // First 3 parts should be a valid date (YYYY-MM-DD)
    const datePattern = /^\d{4}-\d{2}-\d{2}/;
    const dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`;
    return datePattern.test(dateStr);
  }

  /**
   * Extracts components from goalTransactionCode
   * Supports both historical (without transactionId/source) and new formats
   */
  static parse(code: string): {
    transactionDate: string;
    accountNumber: string;
    goalNumber: string;
    transactionId: string;
    source: string;
  } | null {
    if (!this.validate(code)) {
      return null;
    }

    const parts = code.split('-');
    if (parts.length < 5) return null;

    // Date is first 3 parts: YYYY-MM-DD
    const transactionDate = `${parts[0]}-${parts[1]}-${parts[2]}`;

    // Determine if this is historical format (no transactionId/source) or new format
    // New format has at least 7 parts, historical has 5-6 parts
    const hasSourceTracking = parts.length >= 7;

    if (hasSourceTracking) {
      // New format: YYYY-MM-DD-{accountNumber}-{goalNumber}-{transactionId}-{source}
      // Source is the last part
      const source = parts[parts.length - 1];

      // Transaction ID is second to last part
      const transactionId = parts[parts.length - 2];

      // Goal number is third to last part
      const goalNumber = parts[parts.length - 3];

      // Account number is everything between date and goal number
      const accountNumber = parts.slice(3, -3).join('-');

      return {
        transactionDate,
        accountNumber,
        goalNumber,
        transactionId,
        source,
      };
    } else {
      // Historical format: YYYY-MM-DD-{accountNumber}-{goalNumber}
      // Goal number is the last part
      const goalNumber = parts[parts.length - 1];

      // Account number is everything between date and goal number
      const accountNumber = parts.slice(3, -1).join('-');

      return {
        transactionDate,
        accountNumber,
        goalNumber,
        transactionId: '',
        source: '',
      };
    }
  }

  /**
   * Extracts transaction date from code
   */
  static extractDate(code: string): Date | null {
    const parsed = this.parse(code);
    if (!parsed) return null;

    return DateUtils.parseDate(parsed.transactionDate);
  }

  /**
   * Groups transactions by goalTransactionCode
   */
  static groupByCode<T extends { goalTransactionCode: string }>(
    transactions: T[]
  ): Map<string, T[]> {
    const groups = new Map<string, T[]>();

    for (const transaction of transactions) {
      const code = transaction.goalTransactionCode;
      if (!groups.has(code)) {
        groups.set(code, []);
      }
      groups.get(code)!.push(transaction);
    }

    return groups;
  }
}
