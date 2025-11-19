/**
 * String utility functions for cleaning and validating strings
 */

export class StringUtils {
  /**
   * Cleans a string (trims, removes extra whitespace)
   */
  static clean(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    return String(value)
      .trim()
      .replace(/\s+/g, ' '); // Replace multiple spaces with single space
  }

  /**
   * Checks if a string is empty or null
   */
  static isEmpty(value: any): boolean {
    return value === null || value === undefined || this.clean(value) === '';
  }

  /**
   * Validates string length
   */
  static isValidLength(value: string, min: number = 0, max: number = Infinity): boolean {
    const length = value.length;
    return length >= min && length <= max;
  }

  /**
   * Validates against a regex pattern
   */
  static matchesPattern(value: string, pattern: RegExp): boolean {
    return pattern.test(value);
  }

  /**
   * Normalizes a fund code (uppercase, trim)
   */
  static normalizeFundCode(value: string): string {
    return this.clean(value).toUpperCase();
  }

  /**
   * Validates account number format (XXX-XXXXXXXXX)
   */
  static isValidAccountNumber(value: string): boolean {
    const pattern = /^\d{3}-\d{9,}$/;
    return pattern.test(this.clean(value));
  }

  /**
   * Validates goal number format (account number + suffix)
   */
  static isValidGoalNumber(value: string): boolean {
    const pattern = /^\d{3}-\d{9,}[a-z]$/;
    return pattern.test(this.clean(value));
  }

  /**
   * Capitalizes first letter of each word
   */
  static titleCase(value: string): string {
    return value
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Sanitizes a string for use in filenames
   */
  static sanitizeFilename(value: string): string {
    return value
      .replace(/[^a-z0-9_\-\.]/gi, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();
  }
}
