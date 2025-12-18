import Papa from 'papaparse';
import fs from 'fs';
import { logger } from '../../config/logger';
import { DateUtils } from '../../utils/dateUtils';
import { NumberUtils } from '../../utils/numberUtils';
import { StringUtils } from '../../utils/stringUtils';
import { ParsedBankTransaction } from '../../types/bankTransaction';
import { TransactionType } from '@prisma/client';

/**
 * Parser for bank transaction CSV files
 * Handles the bank reconciliation format with fund percentages and amounts
 */
export class BankCSVParser {
  /**
   * Parses a bank transaction CSV file
   * Format: Date, First Name, Last Name, Acc Number, Goal Name, Goal Number,
   * Total Amount, XUMMF%, XUBF%, XUDEF%, XUREF%, XUMMF$, XUBF$, XUDEF$, XUREF$,
   * Transaction Type, Transaction ID
   */
  static async parseFile(filePath: string): Promise<ParsedBankTransaction[]> {
    logger.info(`Starting bank CSV parse: ${filePath}`);

    const transactions: ParsedBankTransaction[] = [];
    let rowNumber = 0;
    let headerCount: { [key: string]: number } = {};

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);

      Papa.parse(stream, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        transformHeader: (header: string) => {
          const trimmed = header.trim();

          // Handle duplicate fund column names
          // First occurrence = percentages, second occurrence = amounts
          if (['XUMMF', 'XUBF', 'XUDEF', 'XUREF'].includes(trimmed)) {
            headerCount[trimmed] = (headerCount[trimmed] || 0) + 1;
            return headerCount[trimmed] === 1
              ? `${trimmed}_pct`
              : `${trimmed}_amt`;
          }

          return trimmed;
        },
        step: (result: Papa.ParseStepResult<any>) => {
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
            logger.warn(`Error parsing bank transaction row ${rowNumber}:`, error);
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
   * Parses a single bank transaction row
   */
  private static parseTransaction(
    row: any,
    rowNumber: number
  ): ParsedBankTransaction | null {
    try {
      // Parse date
      const transactionDate = DateUtils.parseDate(row.Date);
      if (!transactionDate) {
        logger.warn(`Row ${rowNumber}: Invalid transaction date`);
        return null;
      }

      // Parse client information
      const firstName = StringUtils.clean(row['First Name']);
      const lastName = StringUtils.clean(row['Last Name']);
      const accountNumber = StringUtils.clean(row['Acc Number']);
      const goalTitle = StringUtils.clean(row['Goal Name']);
      const goalNumber = StringUtils.clean(row['Goal Number']);
      const transactionId = StringUtils.clean(row['Transaction ID']);

      if (!firstName || !lastName || !accountNumber || !goalNumber || !transactionId) {
        logger.warn(`Row ${rowNumber}: Missing required fields`);
        return null;
      }

      // Parse total amount
      const totalAmount = NumberUtils.parseAmount(row['Total Amount']);
      if (totalAmount === null) {
        logger.warn(`Row ${rowNumber}: Invalid total amount`);
        return null;
      }

      // Parse transaction type
      const transactionTypeStr = StringUtils.clean(row['Transaction Type']);
      const transactionType = BankCSVParser.parseTransactionType(transactionTypeStr);
      if (!transactionType) {
        logger.warn(`Row ${rowNumber}: Invalid transaction type: ${transactionTypeStr}`);
        return null;
      }

      // Parse fund percentages
      const xummfPct = NumberUtils.parseAmount(row.XUMMF_pct);
      const xubfPct = NumberUtils.parseAmount(row.XUBF_pct);
      const xudefPct = NumberUtils.parseAmount(row.XUDEF_pct);
      const xurefPct = NumberUtils.parseAmount(row.XUREF_pct);

      if (xummfPct === null || xubfPct === null || xudefPct === null || xurefPct === null) {
        logger.warn(`Row ${rowNumber}: Invalid fund percentages`);
        return null;
      }

      // Parse fund amounts
      const xummfAmt = NumberUtils.parseAmount(row.XUMMF_amt);
      const xubfAmt = NumberUtils.parseAmount(row.XUBF_amt);
      const xudefAmt = NumberUtils.parseAmount(row.XUDEF_amt);
      const xurefAmt = NumberUtils.parseAmount(row.XUREF_amt);

      if (xummfAmt === null || xubfAmt === null || xudefAmt === null || xurefAmt === null) {
        logger.warn(`Row ${rowNumber}: Invalid fund amounts`);
        return null;
      }

      return {
        rowNumber,
        firstName,
        lastName,
        accountNumber,
        goalTitle,
        goalNumber,
        transactionDate,
        transactionType,
        transactionId,
        totalAmount,
        xummfPercentage: xummfPct,
        xubfPercentage: xubfPct,
        xudefPercentage: xudefPct,
        xurefPercentage: xurefPct,
        xummfAmount: xummfAmt,
        xubfAmount: xubfAmt,
        xudefAmount: xudefAmt,
        xurefAmount: xurefAmt,
      };
    } catch (error) {
      logger.error(`Row ${rowNumber}: Unexpected parsing error:`, error);
      return null;
    }
  }

  /**
   * Checks if a row is empty
   */
  private static isEmptyRow(row: any): boolean {
    return !row || Object.values(row).every((val) => !val || val.toString().trim() === '');
  }

  /**
   * Parses transaction type string to enum
   */
  private static parseTransactionType(typeStr: string): TransactionType | null {
    if (!typeStr) return null;

    const normalized = typeStr.toUpperCase().trim();

    // Map common variations
    const typeMap: { [key: string]: TransactionType } = {
      DEPOSIT: TransactionType.DEPOSIT,
      WITHDRAWAL: TransactionType.WITHDRAWAL,
      REDEMPTION: TransactionType.REDEMPTION,
      SWITCH: TransactionType.SWITCH,
      DIVIDEND: TransactionType.DIVIDEND,
      TRANSFER: TransactionType.TRANSFER,
    };

    return typeMap[normalized] || null;
  }

  /**
   * Validates the CSV file structure
   */
  static async validateFileStructure(filePath: string): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      const requiredHeaders = [
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

      // Read first few rows to check structure
      const stream = fs.createReadStream(filePath);
      let headers: string[] = [];

      await new Promise<void>((resolve, reject) => {
        Papa.parse(stream, {
          header: true,
          preview: 1,
          skipEmptyLines: true,
          step: (result: Papa.ParseStepResult<any>) => {
            headers = result.meta.fields || [];
          },
          complete: () => resolve(),
          error: (error: Error) => reject(error),
        });
      });

      // Check for required headers
      for (const required of requiredHeaders) {
        if (!headers.includes(required)) {
          errors.push(`Missing required column: ${required}`);
        }
      }

      // Check for fund columns (should appear twice each)
      const fundCodes = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
      for (const fund of fundCodes) {
        const count = headers.filter((h) => h === fund).length;
        if (count !== 2) {
          errors.push(
            `Fund column ${fund} should appear exactly twice (percentages and amounts), found ${count} times`
          );
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push(`File structure validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { valid: false, errors };
    }
  }
}
