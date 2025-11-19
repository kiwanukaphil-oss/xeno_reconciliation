/**
 * Number utility functions for parsing and validating amounts
 */

export class NumberUtils {
  /**
   * Parses an amount string (handles currency symbols, commas, parentheses)
   */
  static parseAmount(value: any): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    // If already a number, return it
    if (typeof value === 'number') {
      return isNaN(value) ? null : value;
    }

    // Convert to string and clean
    const str = String(value).trim();
    if (str === '') return null;

    // Remove currency symbols, commas, and spaces
    let cleaned = str
      .replace(/[UGX$£€¥,\s]/gi, '')
      .trim();

    // Handle parentheses (negative numbers)
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      cleaned = '-' + cleaned.slice(1, -1);
    }

    // Parse the number
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Validates that a number is within a range
   */
  static isInRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }

  /**
   * Validates that a number is positive
   */
  static isPositive(value: number): boolean {
    return value > 0;
  }

  /**
   * Compares two numbers with tolerance
   */
  static areEqual(a: number, b: number, tolerance: number = 0.01): boolean {
    return Math.abs(a - b) <= tolerance;
  }

  /**
   * Rounds a number to specified decimal places
   */
  static round(value: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * Formats a number as currency
   */
  static formatCurrency(value: number, currency: string = 'UGX'): string {
    return `${currency} ${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  /**
   * Calculates percentage
   */
  static percentage(value: number, total: number): number {
    if (total === 0) return 0;
    return (value / total) * 100;
  }

  /**
   * Validates decimal places
   */
  static hasValidDecimalPlaces(value: number, maxDecimals: number): boolean {
    const str = value.toString();
    const decimalIndex = str.indexOf('.');
    if (decimalIndex === -1) return true;

    const decimals = str.length - decimalIndex - 1;
    return decimals <= maxDecimals;
  }
}
