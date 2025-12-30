import XLSX from 'xlsx';
import { logger } from '../../../config/logger';
import { DateUtils } from '../../../utils/dateUtils';
import { NumberUtils } from '../../../utils/numberUtils';
import { StringUtils } from '../../../utils/stringUtils';
import { GoalTransactionCodeGenerator } from '../calculators/GoalTransactionCodeGenerator';
import { ParsedFundTransaction } from '../../../types/fundTransaction';
import { TransactionType, TransactionSource } from '@prisma/client';

// Valid enum values for type checking
const VALID_TRANSACTION_TYPES: string[] = Object.values(TransactionType);
const VALID_TRANSACTION_SOURCES: string[] = Object.values(TransactionSource);

/**
 * Parses Excel files (.xlsx, .xls) containing fund transactions
 */
export class ExcelParser {
  /**
   * Parses an Excel file and returns parsed transactions
   */
  static async parseFile(filePath: string): Promise<ParsedFundTransaction[]> {
    logger.info(`Starting Excel parse: ${filePath}`);

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

      // Normalize column headers (trim whitespace) to handle files with spaces in headers
      rawData = rawData.map((row) => {
        const normalizedRow: any = {};
        Object.keys(row).forEach((key) => {
          const trimmedKey = key.trim();
          normalizedRow[trimmedKey] = row[key];
        });
        return normalizedRow;
      });

      logger.info(`Excel file has ${rawData.length} rows`);

      // Parse each row
      const transactions: ParsedFundTransaction[] = [];
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
          logger.warn(`Error parsing Excel row ${rowNumber}:`, error);
          // Continue parsing other rows
        }
      }

      logger.info(`Excel parse completed: ${transactions.length} transactions parsed`);
      return transactions;
    } catch (error) {
      logger.error('Excel parse error:', error);
      throw error;
    }
  }

  /**
   * Parses a single transaction row from Excel
   */
  private static parseTransaction(row: any, rowNumber: number): ParsedFundTransaction | null {
    try {
      // Parse fundTransactionId (required unique identifier)
      const fundTransactionId = StringUtils.clean(row.fundTransactionId);
      if (!fundTransactionId) {
        logger.warn(`Row ${rowNumber}: Missing fundTransactionId`);
        return null;
      }

      // Parse dates
      const transactionDate = this.parseExcelDate(row.transactionDate);
      const dateCreated = this.parseExcelDate(row.dateCreated);

      if (!transactionDate) {
        logger.warn(`Row ${rowNumber}: Invalid transaction date`);
        return null;
      }

      // Parse numbers
      const amount = NumberUtils.parseAmount(row.amount);
      const units = NumberUtils.parseAmount(row.units);
      const bidPrice = NumberUtils.parseAmount(row.bidPrice);
      const offerPrice = NumberUtils.parseAmount(row.offerPrice);
      const midPrice = NumberUtils.parseAmount(row.midPrice);

      if (
        amount === null ||
        units === null ||
        bidPrice === null ||
        offerPrice === null ||
        midPrice === null
      ) {
        logger.warn(`Row ${rowNumber}: Invalid numeric values`);
        return null;
      }

      // Clean strings
      const clientName = StringUtils.clean(row.clientName);
      const fundCode = StringUtils.normalizeFundCode(row.fundCode);
      const accountNumber = StringUtils.clean(row.accountNumber);
      const goalNumber = StringUtils.clean(row.goalNumber);
      const goalTitle = StringUtils.clean(row.goalTitle);
      const transactionTypeStr = StringUtils.clean(row.transactionType).toUpperCase();
      const accountType = StringUtils.clean(row.accountType).toUpperCase();
      const accountCategory = StringUtils.clean(row.accountCategory).toUpperCase();
      const sponsorCode = StringUtils.clean(row.sponsorCode); // Optional

      // Parse source tracking fields (validation will check if required)
      // DO NOT skip rows here - let the validator handle missing fields
      // so we get proper error reporting instead of silent rejection
      const transactionId = StringUtils.clean(row.transactionId) || '';
      const sourceStr = StringUtils.clean(row.source) || '';

      // Convert string to TransactionType enum (validation handles invalid values)
      const transactionType = VALID_TRANSACTION_TYPES.includes(transactionTypeStr)
        ? (transactionTypeStr as TransactionType)
        : (transactionTypeStr as TransactionType); // Keep raw value, validator will catch invalid

      // Convert string to TransactionSource enum (nullable)
      const source = sourceStr && VALID_TRANSACTION_SOURCES.includes(sourceStr)
        ? (sourceStr as TransactionSource)
        : null;

      // Generate goalTransactionCode (includes transactionId and source to distinguish transactions)
      // - transactionId: Handles multiple transactions same day (e.g., regular vs reversal)
      // - source: Handles split disbursements (e.g., same bank txn distributed via BANK, AIRTEL, MTN)
      const goalTransactionCode = GoalTransactionCodeGenerator.generate(
        transactionDate,
        accountNumber,
        goalNumber,
        transactionId,
        sourceStr // Use string version for code generation
      );

      return {
        fundTransactionId,
        goalTransactionCode,
        transactionId,
        source,
        transactionDate,
        clientName,
        fundCode,
        amount,
        units,
        transactionType,
        bidPrice,
        offerPrice,
        midPrice,
        dateCreated: dateCreated || new Date(),
        goalTitle,
        goalNumber,
        accountNumber,
        accountType,
        accountCategory,
        sponsorCode: sponsorCode || undefined,
        rowNumber,
      };
    } catch (error) {
      logger.warn(`Row ${rowNumber}: Parse error`, error);
      return null;
    }
  }

  /**
   * Parses Excel date values
   * Excel stores dates as serial numbers, so we need special handling
   */
  private static parseExcelDate(value: any): Date | null {
    if (!value) return null;

    // If it's already a number (Excel serial date)
    if (typeof value === 'number') {
      const excelDate = XLSX.SSF.parse_date_code(value);
      if (excelDate) {
        return new Date(excelDate.y, excelDate.m - 1, excelDate.d);
      }
    }

    // If it's a string, use DateUtils
    if (typeof value === 'string') {
      return DateUtils.parseDate(value);
    }

    // If it's already a Date object
    if (value instanceof Date) {
      return value;
    }

    return null;
  }

  /**
   * Checks if a row is empty
   */
  private static isEmptyRow(row: any): boolean {
    if (!row) return true;

    const values = Object.values(row);
    return values.every((value) => StringUtils.isEmpty(value));
  }

  /**
   * Validates Excel file headers
   */
  static validateHeaders(filePath: string): {
    isValid: boolean;
    missingHeaders: string[];
    extraHeaders: string[];
  } {
    const requiredHeaders = [
      'fundTransactionId',
      'transactionDate',
      'clientName',
      'fundCode',
      'amount',
      'units',
      'transactionType',
      'bidPrice',
      'offerPrice',
      'midPrice',
      'dateCreated',
      'goalTitle',
      'goalNumber',
      'accountNumber',
      'accountType',
      'accountCategory',
      'transactionId', // Source transaction ID (e.g., from bank statement)
      'source', // Transaction source/channel
      // sponsorCode is optional, not required
    ];

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

      const missingHeaders = requiredHeaders.filter((h) => !actualHeaders.includes(h));
      const extraHeaders = actualHeaders.filter((h) => !requiredHeaders.includes(h));

      return {
        isValid: missingHeaders.length === 0,
        missingHeaders,
        extraHeaders,
      };
    } catch (error) {
      logger.error('Error validating Excel headers:', error);
      return {
        isValid: false,
        missingHeaders: requiredHeaders,
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
      logger.error('Error getting Excel row count:', error);
      return 0;
    }
  }
}
