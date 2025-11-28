import { DateUtils } from '../../../utils/dateUtils';

/**
 * Generates unique codes linking related fund transactions
 * Format: {YYYY-MM-DD}-{accountNumber}-{goalNumber}-{transactionId}-{source}
 * Example: "2018-07-24-701-555863519-701-5558635193a-123456789-BANK"
 *
 * The transactionId and source are included to distinguish between:
 * - Multiple transactions on the same day (e.g., regular vs reversal)
 * - Split disbursements with same bank transaction ID but different payment methods
 *   (e.g., BANK123 distributed via BANK, AIRTEL_MONEY, MTN_MOMO)
 */
export class GoalTransactionCodeGenerator {
  /**
   * Generates a goalTransactionCode from transaction details
   */
  static generate(
    transactionDate: Date | string,
    accountNumber: string,
    goalNumber: string,
    transactionId: string,
    source: string
  ): string {
    // Normalize date to YYYY-MM-DD format
    const dateStr =
      typeof transactionDate === 'string'
        ? this.normalizeDate(transactionDate)
        : DateUtils.formatDate(transactionDate);

    // Clean inputs (remove extra spaces)
    const cleanAccount = accountNumber.trim();
    const cleanGoal = goalNumber.trim();
    const cleanTransactionId = transactionId.trim();
    const cleanSource = source.trim();

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
   */
  static validate(code: string): boolean {
    // Pattern: YYYY-MM-DD-{accountNumber}-{goalNumber}-{transactionId}-{source}
    // At minimum: YYYY-MM-DD-XXX-XXXXXXXXX-XXX-XXXXXXXXXa-XXXXX-BANK
    // Must have at least 7 parts (date parts + account + goal + transactionId + source)
    const parts = code.split('-');
    if (parts.length < 7) return false;

    // First 3 parts should be a valid date (YYYY-MM-DD)
    const datePattern = /^\d{4}-\d{2}-\d{2}/;
    const dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`;
    return datePattern.test(dateStr);
  }

  /**
   * Extracts components from goalTransactionCode
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
    if (parts.length < 7) return null;

    // Date is first 3 parts: YYYY-MM-DD
    const transactionDate = `${parts[0]}-${parts[1]}-${parts[2]}`;

    // Source is the last part
    const source = parts[parts.length - 1];

    // Transaction ID is second to last part
    const transactionId = parts[parts.length - 2];

    // Goal number is third to last part
    const goalNumber = parts[parts.length - 3];

    // Account number is everything between date and goal number
    // Join with dashes in case account number itself contains dashes
    const accountNumber = parts.slice(3, -3).join('-');

    return {
      transactionDate,
      accountNumber,
      goalNumber,
      transactionId,
      source,
    };
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
