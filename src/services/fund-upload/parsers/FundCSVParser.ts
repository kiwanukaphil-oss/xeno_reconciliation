import Papa from 'papaparse';
import fs from 'fs';
import { logger } from '../../../config/logger';
import { DateUtils } from '../../../utils/dateUtils';
import { NumberUtils } from '../../../utils/numberUtils';
import { StringUtils } from '../../../utils/stringUtils';
import { GoalTransactionCodeGenerator } from '../calculators/GoalTransactionCodeGenerator';
import {
  RawFundTransactionRow,
  ParsedFundTransaction,
} from '../../../types/fundTransaction';

export class FundCSVParser {
  /**
   * Parses a CSV file and returns parsed transactions
   * Uses streaming for memory efficiency with large files
   */
  static async parseFile(filePath: string): Promise<ParsedFundTransaction[]> {
    logger.info(`Starting CSV parse: ${filePath}`);

    const transactions: ParsedFundTransaction[] = [];
    let rowNumber = 0;

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);

      Papa.parse(stream, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // Keep as strings for custom parsing
        transformHeader: (header: string) => {
          // Normalize headers (trim, lowercase)
          return header.trim();
        },
        step: (result: Papa.ParseStepResult<RawFundTransactionRow>) => {
          rowNumber++;

          try {
            const row = result.data;

            // Skip empty rows
            if (FundCSVParser.isEmptyRow(row)) {
              return;
            }

            // Parse the transaction
            const parsed = FundCSVParser.parseTransaction(row, rowNumber);
            if (parsed) {
              transactions.push(parsed);
            }
          } catch (error) {
            logger.warn(`Error parsing row ${rowNumber}:`, error);
            // Continue parsing other rows
          }
        },
        complete: () => {
          logger.info(`CSV parse completed: ${transactions.length} transactions parsed`);
          resolve(transactions);
        },
        error: (error: Error) => {
          logger.error('CSV parse error:', error);
          reject(error);
        },
      });
    });
  }

  /**
   * Parses a single transaction row
   */
  private static parseTransaction(
    row: RawFundTransactionRow,
    rowNumber: number
  ): ParsedFundTransaction | null {
    try {
      // Parse fundTransactionId (required unique identifier)
      const fundTransactionId = StringUtils.clean(row.fundTransactionId);
      if (!fundTransactionId) {
        logger.warn(`Row ${rowNumber}: Missing fundTransactionId`);
        return null;
      }

      // Parse dates
      const transactionDate = DateUtils.parseDate(row.transactionDate);
      const dateCreated = DateUtils.parseDate(row.dateCreated);

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

      if (amount === null || units === null || bidPrice === null || offerPrice === null || midPrice === null) {
        logger.warn(`Row ${rowNumber}: Invalid numeric values`);
        return null;
      }

      // Clean strings
      const clientName = StringUtils.clean(row.clientName);
      const fundCode = StringUtils.normalizeFundCode(row.fundCode);
      const accountNumber = StringUtils.clean(row.accountNumber);
      const goalNumber = StringUtils.clean(row.goalNumber);
      const goalTitle = StringUtils.clean(row.goalTitle);
      const transactionType = StringUtils.clean(row.transactionType).toUpperCase();
      const accountType = StringUtils.clean(row.accountType).toUpperCase();
      const accountCategory = StringUtils.clean(row.accountCategory).toUpperCase();
      const sponsorCode = StringUtils.clean(row.sponsorCode); // Optional

      // Parse source tracking fields (validation will check if required)
      // DO NOT skip rows here - let the validator handle missing fields
      // so we get proper error reporting instead of silent rejection
      const transactionId = StringUtils.clean(row.transactionId) || '';
      const source = StringUtils.clean(row.source) || '';

      // Generate goalTransactionCode (includes transactionId and source to distinguish transactions)
      // - transactionId: Handles multiple transactions same day (e.g., regular vs reversal)
      // - source: Handles split disbursements (e.g., same bank txn distributed via BANK, AIRTEL, MTN)
      const goalTransactionCode = GoalTransactionCodeGenerator.generate(
        transactionDate,
        accountNumber,
        goalNumber,
        transactionId,
        source
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
   * Checks if a row is empty
   */
  private static isEmptyRow(row: any): boolean {
    if (!row) return true;

    const values = Object.values(row);
    return values.every((value) => StringUtils.isEmpty(value));
  }

  /**
   * Validates CSV headers
   */
  static validateHeaders(filePath: string): Promise<{
    isValid: boolean;
    missingHeaders: string[];
    extraHeaders: string[];
  }> {
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

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);

      Papa.parse(stream, {
        header: true,
        preview: 1, // Only read first row
        complete: (results) => {
          const actualHeaders = results.meta.fields || [];

          const missingHeaders = requiredHeaders.filter(
            (h) => !actualHeaders.includes(h)
          );

          const extraHeaders = actualHeaders.filter(
            (h) => !requiredHeaders.includes(h)
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
}
