import Papa from 'papaparse';
import fs from 'fs';
import { logger } from '../../../config/logger';
import { ParsedBankTransaction, RawBankTransactionRow } from '../../../types/bankTransaction';
import { TransactionType } from '@prisma/client';

// Valid enum values for type checking
const VALID_TRANSACTION_TYPES: string[] = Object.values(TransactionType);

/**
 * Parses bank transaction CSV files using streaming for memory efficiency
 * Mirrors FundCSVParser for consistency
 */
export class BankCSVParser {
  /**
   * Required CSV headers for bank transactions
   */
  private static readonly REQUIRED_HEADERS = [
    'Date',
    'First Name',
    'Last Name',
    'Acc Number',
    'Goal Name',
    'Goal Number',
    'Total Amount',
    'Transaction Type',
    'Transaction ID',
  ];

  /**
   * Parses a CSV file and returns parsed transactions
   * Uses streaming for memory efficiency with large files
   */
  static async parseFile(filePath: string): Promise<ParsedBankTransaction[]> {
    logger.info(`Starting bank CSV parse: ${filePath}`);

    const transactions: ParsedBankTransaction[] = [];
    let rowNumber = 0;

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);

      Papa.parse(stream, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        transformHeader: (header: string) => {
          return header.trim();
        },
        step: (result: Papa.ParseStepResult<RawBankTransactionRow>) => {
          rowNumber++;

          try {
            const row = result.data;

            // Skip empty rows
            if (BankCSVParser.isEmptyRow(row)) {
              return;
            }

            // Parse the transaction
            const parsed = BankCSVParser.parseTransaction(row, rowNumber);
            if (parsed) {
              transactions.push(parsed);
            }
          } catch (error) {
            logger.warn(`Error parsing bank row ${rowNumber}:`, error);
          }
        },
        complete: () => {
          logger.info(`Bank CSV parse completed: ${transactions.length} transactions parsed`);
          resolve(transactions);
        },
        error: (error: Error) => {
          logger.error('Bank CSV parse error:', error);
          reject(error);
        },
      });
    });
  }

  /**
   * Parses a single transaction row
   */
  private static parseTransaction(
    row: RawBankTransactionRow,
    rowNumber: number
  ): ParsedBankTransaction | null {
    try {
      // Parse date - supports multiple formats
      const transactionDate = BankCSVParser.parseDate(row['Date'] || row['date']);
      if (!transactionDate) {
        logger.warn(`Row ${rowNumber}: Invalid date`);
        return null;
      }

      // Parse required string fields
      const firstName = BankCSVParser.cleanString(row['First Name'] || row['first name'] || '');
      const lastName = BankCSVParser.cleanString(row['Last Name'] || row['last name'] || '');
      const accountNumber = BankCSVParser.cleanString(row['Acc Number'] || row['acc number'] || '');
      const goalTitle = BankCSVParser.cleanString(row['Goal Name'] || row['goal name'] || '');
      const goalNumber = BankCSVParser.cleanString(row['Goal Number'] || row['goal number'] || '');
      const transactionTypeStr = BankCSVParser.cleanString(row['Transaction Type'] || row['transaction type'] || '').toUpperCase();
      const transactionId = BankCSVParser.cleanString(row['Transaction ID'] || row['transaction id'] || '');

      // Convert string to TransactionType enum (validation handles invalid values)
      const transactionType = VALID_TRANSACTION_TYPES.includes(transactionTypeStr)
        ? (transactionTypeStr as TransactionType)
        : (transactionTypeStr as TransactionType); // Keep raw value, validator will catch invalid

      // Parse total amount
      const totalAmount = BankCSVParser.parseAmount(row['Total Amount'] || row['total amount']);
      if (totalAmount === null) {
        logger.warn(`Row ${rowNumber}: Invalid total amount`);
        return null;
      }

      // Parse fund percentages and amounts
      // The CSV may have duplicate column names for percentages and amounts
      // We need to detect which is which based on values
      const fundData = BankCSVParser.parseFundDistribution(row, totalAmount);

      return {
        transactionDate,
        firstName,
        lastName,
        accountNumber,
        goalTitle,
        goalNumber,
        totalAmount,
        transactionType,
        transactionId,
        xummfPercentage: fundData.xummfPercentage,
        xubfPercentage: fundData.xubfPercentage,
        xudefPercentage: fundData.xudefPercentage,
        xurefPercentage: fundData.xurefPercentage,
        xummfAmount: fundData.xummfAmount,
        xubfAmount: fundData.xubfAmount,
        xudefAmount: fundData.xudefAmount,
        xurefAmount: fundData.xurefAmount,
        rowNumber,
      };
    } catch (error) {
      logger.warn(`Row ${rowNumber}: Parse error`, error);
      return null;
    }
  }

  /**
   * Parses fund distribution from row
   * Handles various column naming conventions
   */
  private static parseFundDistribution(row: any, totalAmount: number): {
    xummfPercentage: number;
    xubfPercentage: number;
    xudefPercentage: number;
    xurefPercentage: number;
    xummfAmount: number;
    xubfAmount: number;
    xudefAmount: number;
    xurefAmount: number;
  } {
    const keys = Object.keys(row);
    const fundCodes = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
    const result: any = {
      xummfPercentage: 0, xubfPercentage: 0, xudefPercentage: 0, xurefPercentage: 0,
      xummfAmount: 0, xubfAmount: 0, xudefAmount: 0, xurefAmount: 0,
    };

    for (const fundCode of fundCodes) {
      const lowerFund = fundCode.toLowerCase();

      // Find columns that match this fund
      const matchingKeys = keys.filter(k =>
        k.toUpperCase().includes(fundCode) ||
        k.toLowerCase().includes(lowerFund)
      );

      // Categorize columns by name patterns
      let percentageKey: string | null = null;
      let amountKey: string | null = null;
      const uncategorized: string[] = [];

      for (const key of matchingKeys) {
        const keyLower = key.toLowerCase();
        // Check for percentage indicators
        if (keyLower.includes('%') || keyLower.includes('pct') || keyLower.includes('percent') || key.endsWith('_pct')) {
          percentageKey = key;
        }
        // Check for amount indicators
        else if (keyLower.includes('$') || keyLower.includes('amt') || keyLower.includes('amount') || key.endsWith('_amt')) {
          amountKey = key;
        } else {
          uncategorized.push(key);
        }
      }

      // Parse percentage if found
      if (percentageKey) {
        const pctVal = BankCSVParser.parseAmount(row[percentageKey]);
        if (pctVal !== null) {
          result[`${lowerFund}Percentage`] = pctVal;
        }
      }

      // Parse amount if found
      if (amountKey) {
        const amtVal = BankCSVParser.parseAmount(row[amountKey]);
        if (amtVal !== null) {
          result[`${lowerFund}Amount`] = amtVal;
        }
      }

      // Handle uncategorized columns (fallback to magnitude-based detection)
      if (uncategorized.length > 0) {
        const values: { key: string; value: number }[] = [];
        for (const key of uncategorized) {
          const val = BankCSVParser.parseAmount(row[key]);
          if (val !== null) {
            values.push({ key, value: val });
          }
        }

        // Sort by value - smaller is likely percentage
        values.sort((a, b) => a.value - b.value);

        // If we don't have percentage yet, try to get it
        if (!percentageKey && values.length > 0) {
          const smallerVal = values[0].value;
          // Only treat as percentage if it looks like a percentage (0-100 range)
          if (smallerVal >= 0 && smallerVal <= 100) {
            result[`${lowerFund}Percentage`] = smallerVal;
            values.shift(); // Remove from values
          }
        }

        // If we don't have amount yet, use remaining value
        if (!amountKey && values.length > 0) {
          result[`${lowerFund}Amount`] = values[0].value;
        }
      }

      // If we have percentage but no amount, calculate amount from percentage
      if (result[`${lowerFund}Percentage`] > 0 && result[`${lowerFund}Amount`] === 0 && totalAmount !== 0) {
        result[`${lowerFund}Amount`] = (result[`${lowerFund}Percentage`] / 100) * Math.abs(totalAmount);
      }

      // If we have amount but no percentage, calculate percentage from amount
      if (result[`${lowerFund}Amount`] > 0 && result[`${lowerFund}Percentage`] === 0 && totalAmount !== 0) {
        result[`${lowerFund}Percentage`] = (result[`${lowerFund}Amount`] / Math.abs(totalAmount)) * 100;
      }
    }

    return result;
  }

  /**
   * Parses date string to Date object
   * Supports multiple formats explicitly to avoid JavaScript Date parsing issues
   * IMPORTANT: All dates are created in UTC to prevent timezone shift issues
   */
  static parseDate(dateStr: string | undefined): Date | null {
    if (!dateStr) return null;

    const cleanDate = dateStr.trim();
    if (!cleanDate) return null;

    const months: { [key: string]: number } = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'sept': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11,
    };

    // Helper to convert 2-digit year to 4-digit
    const expandYear = (y: number): number => {
      if (y >= 100) return y; // Already 4-digit
      return y < 50 ? 2000 + y : 1900 + y;
    };

    // Helper to create UTC date (prevents timezone shift when storing in DB)
    const createUTCDate = (year: number, month: number, day: number): Date => {
      return new Date(Date.UTC(year, month, day));
    };

    // 1. Try ISO format: YYYY-MM-DD or YYYY/MM/DD
    const isoMatch = cleanDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return createUTCDate(year, month, day);
      }
    }

    // 2. Try DD-Mon-YY or DD/Mon/YY or DD-Mon-YYYY (e.g., 15-Jan-25, 2-Jan-25, 15-Jan-2025)
    const dayMonthYearMatch = cleanDate.match(/^(\d{1,2})[-/]([A-Za-z]+)[-/](\d{2,4})$/);
    if (dayMonthYearMatch) {
      const day = parseInt(dayMonthYearMatch[1], 10);
      const monthStr = dayMonthYearMatch[2].toLowerCase();
      const year = expandYear(parseInt(dayMonthYearMatch[3], 10));
      const month = months[monthStr];
      if (month !== undefined && day >= 1 && day <= 31) {
        return createUTCDate(year, month, day);
      }
    }

    // 3. Try DD/MM/YYYY or DD-MM-YYYY (European format - most common in banking)
    const europeanMatch = cleanDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (europeanMatch) {
      const day = parseInt(europeanMatch[1], 10);
      const month = parseInt(europeanMatch[2], 10) - 1;
      const year = parseInt(europeanMatch[3], 10);
      // Validate ranges - if day > 12, it must be DD/MM format
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return createUTCDate(year, month, day);
      }
    }

    // 4. Try DD/MM/YY or DD-MM-YY (European short year)
    const europeanShortMatch = cleanDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
    if (europeanShortMatch) {
      const day = parseInt(europeanShortMatch[1], 10);
      const month = parseInt(europeanShortMatch[2], 10) - 1;
      const year = expandYear(parseInt(europeanShortMatch[3], 10));
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        return createUTCDate(year, month, day);
      }
    }

    // 5. Try Mon-DD-YYYY or Mon DD, YYYY (e.g., Jan-15-2025 or Jan 15, 2025)
    const monthDayYearMatch = cleanDate.match(/^([A-Za-z]+)[-/\s]+(\d{1,2})[,]?\s*[-/]?\s*(\d{2,4})$/);
    if (monthDayYearMatch) {
      const monthStr = monthDayYearMatch[1].toLowerCase();
      const day = parseInt(monthDayYearMatch[2], 10);
      const year = expandYear(parseInt(monthDayYearMatch[3], 10));
      const month = months[monthStr];
      if (month !== undefined && day >= 1 && day <= 31) {
        return createUTCDate(year, month, day);
      }
    }

    // 6. Try Excel serial date number (days since 1899-12-30)
    const numericMatch = cleanDate.match(/^(\d{5})$/);
    if (numericMatch) {
      const serial = parseInt(numericMatch[1], 10);
      // Excel epoch is December 30, 1899 in UTC
      const excelEpochMs = Date.UTC(1899, 11, 30);
      const result = new Date(excelEpochMs + serial * 24 * 60 * 60 * 1000);
      if (!isNaN(result.getTime())) {
        return result;
      }
    }

    // 7. Last resort: try native Date parsing but be careful
    // Only use if it looks like a reasonable date string
    if (cleanDate.includes(' ') || cleanDate.includes('T')) {
      const parsed = new Date(cleanDate);
      if (!isNaN(parsed.getTime())) {
        // Sanity check - date should be between 1990 and 2100
        const year = parsed.getFullYear();
        if (year >= 1990 && year <= 2100) {
          return parsed;
        }
      }
    }

    return null;
  }

  /**
   * Parses amount string to number
   * Handles currency symbols, commas, negative values
   */
  static parseAmount(amountStr: string | undefined): number | null {
    if (amountStr === undefined || amountStr === null) return null;

    let clean = String(amountStr).trim();
    if (!clean) return 0;

    // Remove currency symbols and formatting
    clean = clean.replace(/[UGX,$\s]/gi, '');

    // Handle parentheses for negative numbers
    const isNegative = clean.startsWith('(') && clean.endsWith(')') || clean.startsWith('-');
    clean = clean.replace(/[()]/g, '').replace(/^-/, '');

    // Remove thousand separators
    clean = clean.replace(/,/g, '');

    const value = parseFloat(clean);
    if (isNaN(value)) return null;

    return isNegative ? -value : value;
  }

  /**
   * Cleans and trims a string value
   */
  static cleanString(value: string | undefined): string {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  /**
   * Checks if a row is empty
   */
  private static isEmptyRow(row: any): boolean {
    if (!row) return true;
    const values = Object.values(row);
    return values.every((value) => !value || String(value).trim() === '');
  }

  /**
   * Validates CSV headers
   */
  static validateHeaders(filePath: string): Promise<{
    isValid: boolean;
    missingHeaders: string[];
    extraHeaders: string[];
  }> {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);

      Papa.parse(stream, {
        header: true,
        preview: 1,
        complete: (results) => {
          const actualHeaders = (results.meta.fields || []).map(h => h.toLowerCase().trim());

          const requiredLower = BankCSVParser.REQUIRED_HEADERS.map(h => h.toLowerCase());

          const missingHeaders = requiredLower.filter(
            (h) => !actualHeaders.some(ah => ah.includes(h.split(' ')[0]))
          );

          const extraHeaders = actualHeaders.filter(
            (h) => !requiredLower.some(rh => h.includes(rh.split(' ')[0]))
          );

          resolve({
            isValid: missingHeaders.length === 0,
            missingHeaders,
            extraHeaders,
          });
        },
        error: (error: Error) => {
          reject(error);
        },
      });
    });
  }

  /**
   * Gets row count from CSV file
   */
  static async getRowCount(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let count = 0;
      const stream = fs.createReadStream(filePath);

      Papa.parse(stream, {
        header: true,
        skipEmptyLines: true,
        step: () => {
          count++;
        },
        complete: () => {
          resolve(count);
        },
        error: (error: Error) => {
          reject(error);
        },
      });
    });
  }

  /**
   * Validates file structure
   */
  static async validateFileStructure(filePath: string): Promise<{
    valid: boolean;
    errors: string[];
    rowCount?: number;
  }> {
    const errors: string[] = [];

    try {
      const headerValidation = await BankCSVParser.validateHeaders(filePath);
      if (!headerValidation.isValid) {
        errors.push(`Missing required columns: ${headerValidation.missingHeaders.join(', ')}`);
      }

      const rowCount = await BankCSVParser.getRowCount(filePath);
      if (rowCount === 0) {
        errors.push('File contains no data rows');
      }

      return {
        valid: errors.length === 0,
        errors,
        rowCount,
      };
    } catch (error: any) {
      errors.push(`File validation error: ${error.message}`);
      return { valid: false, errors };
    }
  }
}
