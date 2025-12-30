import XLSX from 'xlsx';
import { logger } from '../../../config/logger';
import { ParsedBankTransaction } from '../../../types/bankTransaction';
import { BankCSVParser } from './BankCSVParser';
import { TransactionType } from '@prisma/client';

// Valid enum values for type checking
const VALID_TRANSACTION_TYPES: string[] = Object.values(TransactionType);

/**
 * Parses Excel files (.xlsx, .xls) containing bank transactions
 * Mirrors the fund upload ExcelParser for consistency
 */
export class BankExcelParser {
  /**
   * Required Excel headers for bank transactions
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
   * Parses an Excel file and returns parsed transactions
   */
  static async parseFile(filePath: string): Promise<ParsedBankTransaction[]> {
    logger.info(`Starting bank Excel parse: ${filePath}`);

    try {
      // Read the Excel file
      const workbook = XLSX.readFile(filePath);

      // Get the first sheet
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('Excel file has no sheets');
      }

      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON with header row
      let rawData: any[] = XLSX.utils.sheet_to_json(worksheet, {
        raw: false, // Keep as strings for custom parsing
        defval: '', // Default value for empty cells
      });

      // Normalize column headers (trim whitespace)
      rawData = rawData.map((row) => {
        const normalizedRow: any = {};
        Object.keys(row).forEach((key) => {
          const trimmedKey = key.trim();
          normalizedRow[trimmedKey] = row[key];
        });
        return normalizedRow;
      });

      logger.info(`Bank Excel file has ${rawData.length} rows`);

      // Parse each row
      const transactions: ParsedBankTransaction[] = [];
      let rowNumber = 1; // Excel row numbers start at 1, plus 1 for header

      for (const row of rawData) {
        rowNumber++;

        // Skip empty rows
        if (this.isEmptyRow(row)) {
          continue;
        }

        try {
          const parsed = this.parseTransaction(row, rowNumber);
          if (parsed) {
            transactions.push(parsed);
          }
        } catch (error) {
          logger.warn(`Error parsing bank Excel row ${rowNumber}:`, error);
          // Continue parsing other rows
        }
      }

      logger.info(`Bank Excel parse completed: ${transactions.length} transactions parsed`);
      return transactions;
    } catch (error) {
      logger.error('Bank Excel parse error:', error);
      throw error;
    }
  }

  /**
   * Parses a single transaction row from Excel
   */
  private static parseTransaction(row: any, rowNumber: number): ParsedBankTransaction | null {
    try {
      // Parse date - supports multiple formats including Excel serial dates
      const transactionDate = this.parseExcelDate(row['Date'] || row['date']);
      if (!transactionDate) {
        logger.warn(`Row ${rowNumber}: Invalid date`);
        return null;
      }

      // Parse required string fields (case-insensitive header matching)
      const firstName = this.cleanString(row['First Name'] || row['first name'] || '');
      const lastName = this.cleanString(row['Last Name'] || row['last name'] || '');
      const accountNumber = this.cleanString(row['Acc Number'] || row['acc number'] || '');
      const goalTitle = this.cleanString(row['Goal Name'] || row['goal name'] || '');
      const goalNumber = this.cleanString(row['Goal Number'] || row['goal number'] || '');
      const transactionTypeStr = this.cleanString(row['Transaction Type'] || row['transaction type'] || '').toUpperCase();
      const transactionId = this.cleanString(row['Transaction ID'] || row['transaction id'] || '');

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

      // Parse fund percentages and amounts using shared logic from CSV parser
      const fundData = this.parseFundDistribution(row, totalAmount);

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
   * Handles various column naming conventions (same logic as CSV parser)
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
   * Parses Excel date values
   * Excel stores dates as serial numbers, so we need special handling
   * IMPORTANT: All dates are created in UTC to prevent timezone shift issues
   */
  private static parseExcelDate(value: any): Date | null {
    if (!value) return null;

    // If it's already a number (Excel serial date)
    if (typeof value === 'number') {
      const excelDate = XLSX.SSF.parse_date_code(value);
      if (excelDate) {
        // Use UTC to prevent timezone shift
        return new Date(Date.UTC(excelDate.y, excelDate.m - 1, excelDate.d));
      }
    }

    // If it's a string, use shared CSV date parsing (which also uses UTC)
    if (typeof value === 'string') {
      return BankCSVParser.parseDate(value);
    }

    // If it's already a Date object, normalize to UTC midnight
    if (value instanceof Date) {
      return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
    }

    return null;
  }

  /**
   * Cleans and trims a string value
   */
  private static cleanString(value: any): string {
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
   * Validates Excel file headers
   */
  static validateHeaders(filePath: string): {
    isValid: boolean;
    missingHeaders: string[];
    extraHeaders: string[];
  } {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Get headers from first row
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const actualHeaders: string[] = [];

      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
        const cell = worksheet[cellAddress];
        if (cell && cell.v) {
          actualHeaders.push(String(cell.v).trim());
        }
      }

      const actualHeadersLower = actualHeaders.map(h => h.toLowerCase());
      const requiredLower = this.REQUIRED_HEADERS.map(h => h.toLowerCase());

      const missingHeaders = requiredLower.filter(
        (h) => !actualHeadersLower.some(ah => ah.includes(h.split(' ')[0]))
      );

      const extraHeaders = actualHeaders.filter(
        (h) => !requiredLower.some(rh => h.toLowerCase().includes(rh.split(' ')[0]))
      );

      return {
        isValid: missingHeaders.length === 0,
        missingHeaders,
        extraHeaders,
      };
    } catch (error) {
      logger.error('Error validating bank Excel headers:', error);
      return {
        isValid: false,
        missingHeaders: this.REQUIRED_HEADERS,
        extraHeaders: [],
      };
    }
  }

  /**
   * Gets row count from Excel file
   */
  static getRowCount(filePath: string): number {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Get the range
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

      // Number of rows minus header row
      return range.e.r > 0 ? range.e.r : 0;
    } catch (error) {
      logger.error('Error getting bank Excel row count:', error);
      return 0;
    }
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
      const headerValidation = this.validateHeaders(filePath);
      if (!headerValidation.isValid) {
        errors.push(`Missing required columns: ${headerValidation.missingHeaders.join(', ')}`);
      }

      const rowCount = this.getRowCount(filePath);
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
