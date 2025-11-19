/**
 * Date utility functions for parsing and validating dates
 */

export class DateUtils {
  private static readonly MONTH_ABBREV: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  /**
   * Parses a date string in various formats
   */
  static parseDate(dateStr: string): Date | null {
    if (!dateStr || typeof dateStr !== 'string') {
      return null;
    }

    const trimmed = dateStr.trim();

    // Try ISO format first (fastest)
    const isoDate = new Date(trimmed);
    if (!isNaN(isoDate.getTime()) && trimmed.includes('-')) {
      return isoDate;
    }

    // Try DD/MM/YYYY
    const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (this.isValidDate(date)) return date;
    }

    // Try MM/DD/YYYY (US format)
    const mmddyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
    if (mmddyyyy) {
      const [, month, day, year] = mmddyyyy;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (this.isValidDate(date)) return date;
    }

    // Try DD/MM/YY
    const ddmmyy = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(trimmed);
    if (ddmmyy) {
      const [, day, month, year] = ddmmyy;
      const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
      const date = new Date(fullYear, parseInt(month) - 1, parseInt(day));
      if (this.isValidDate(date)) return date;
    }

    // Try DD-MMM-YY
    const ddmmmyy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(trimmed);
    if (ddmmmyy) {
      const [, day, monthStr, year] = ddmmmyy;
      const month = this.MONTH_ABBREV[monthStr.toLowerCase()];
      if (month !== undefined) {
        const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
        const date = new Date(fullYear, month, parseInt(day));
        if (this.isValidDate(date)) return date;
      }
    }

    return null;
  }

  /**
   * Validates if a date is valid
   */
  private static isValidDate(date: Date): boolean {
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Formats a date to YYYY-MM-DD
   */
  static formatDate(date: Date): string {
    if (!this.isValidDate(date)) {
      throw new Error('Invalid date');
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Checks if date is within acceptable range
   */
  static isDateInRange(
    date: Date,
    yearsPast: number = 10,
    yearsFuture: number = 0
  ): boolean {
    const today = new Date();
    const minDate = new Date();
    minDate.setFullYear(today.getFullYear() - yearsPast);

    const maxDate = new Date();
    maxDate.setFullYear(today.getFullYear() + yearsFuture);

    return date >= minDate && date <= maxDate;
  }

  /**
   * Checks if date is in the future
   */
  static isFutureDate(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date > today;
  }

  /**
   * Gets the difference in days between two dates
   */
  static daysDifference(date1: Date, date2: Date): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Creates a date at midnight (00:00:00)
   */
  static startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
