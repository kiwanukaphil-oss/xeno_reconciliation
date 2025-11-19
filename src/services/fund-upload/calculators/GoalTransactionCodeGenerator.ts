import { DateUtils } from '../../../utils/dateUtils';

/**
 * Generates unique codes linking related fund transactions
 * Format: {YYYY-MM-DD}-{accountNumber}-{goalNumber}
 * Example: "2018-07-24-701-555863519-701-5558635193a"
 */
export class GoalTransactionCodeGenerator {
  /**
   * Generates a goalTransactionCode from transaction details
   */
  static generate(
    transactionDate: Date | string,
    accountNumber: string,
    goalNumber: string
  ): string {
    // Normalize date to YYYY-MM-DD format
    const dateStr =
      typeof transactionDate === 'string'
        ? this.normalizeDate(transactionDate)
        : DateUtils.formatDate(transactionDate);

    // Clean account and goal numbers (remove extra spaces)
    const cleanAccount = accountNumber.trim();
    const cleanGoal = goalNumber.trim();

    return `${dateStr}-${cleanAccount}-${cleanGoal}`;
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
    // Pattern: YYYY-MM-DD-{accountNumber}-{goalNumber}
    // At minimum: YYYY-MM-DD-XXX-XXXXXXXXX-XXX-XXXXXXXXXa
    const pattern = /^\d{4}-\d{2}-\d{2}-.+-.+$/;
    return pattern.test(code);
  }

  /**
   * Extracts components from goalTransactionCode
   */
  static parse(code: string): {
    transactionDate: string;
    accountNumber: string;
    goalNumber: string;
  } | null {
    if (!this.validate(code)) {
      return null;
    }

    const parts = code.split('-');
    if (parts.length < 5) return null;

    // Date is first 3 parts: YYYY-MM-DD
    const transactionDate = `${parts[0]}-${parts[1]}-${parts[2]}`;

    // Goal number is the last part (after last dash)
    const goalNumber = parts[parts.length - 1];

    // Account number is everything between date and goal number
    // Join with dashes in case account number itself contains dashes
    const accountNumber = parts.slice(3, -1).join('-');

    return {
      transactionDate,
      accountNumber,
      goalNumber,
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
