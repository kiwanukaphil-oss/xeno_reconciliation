import path from 'path';
import { logger } from '../../../config/logger';
import { ParsedBankTransaction } from '../../../types/bankTransaction';
import { BankCSVParser } from './BankCSVParser';
import { BankExcelParser } from './BankExcelParser';

/**
 * Unified file parser for bank transactions
 * Dispatches to appropriate parser based on file extension
 * Mirrors the fund upload UnifiedFileParser for consistency
 */
export class BankUnifiedFileParser {
  /**
   * Supported file extensions
   */
  static readonly SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

  /**
   * Parses a file based on its extension
   */
  static async parseFile(filePath: string): Promise<ParsedBankTransaction[]> {
    const ext = path.extname(filePath).toLowerCase();

    logger.info(`BankUnifiedFileParser: Parsing file with extension ${ext}`);

    switch (ext) {
      case '.csv':
        return await BankCSVParser.parseFile(filePath);
      case '.xlsx':
      case '.xls':
        return await BankExcelParser.parseFile(filePath);
      default:
        throw new Error(
          `Unsupported file type: ${ext}. Supported types: ${this.SUPPORTED_EXTENSIONS.join(', ')}`
        );
    }
  }

  /**
   * Validates file headers based on extension
   */
  static async validateHeaders(filePath: string): Promise<{
    isValid: boolean;
    missingHeaders: string[];
    extraHeaders: string[];
  }> {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.csv':
        return await BankCSVParser.validateHeaders(filePath);
      case '.xlsx':
      case '.xls':
        return BankExcelParser.validateHeaders(filePath);
      default:
        return {
          isValid: false,
          missingHeaders: ['Unsupported file type'],
          extraHeaders: [],
        };
    }
  }

  /**
   * Gets row count from file
   */
  static async getRowCount(filePath: string): Promise<number> {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.csv':
        return await BankCSVParser.getRowCount(filePath);
      case '.xlsx':
      case '.xls':
        return BankExcelParser.getRowCount(filePath);
      default:
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
    const ext = path.extname(filePath).toLowerCase();

    // Check if extension is supported
    if (!this.SUPPORTED_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        errors: [`Unsupported file type: ${ext}. Supported types: ${this.SUPPORTED_EXTENSIONS.join(', ')}`],
      };
    }

    switch (ext) {
      case '.csv':
        return await BankCSVParser.validateFileStructure(filePath);
      case '.xlsx':
      case '.xls':
        return await BankExcelParser.validateFileStructure(filePath);
      default:
        return {
          valid: false,
          errors: ['Unknown file type'],
        };
    }
  }

  /**
   * Checks if a file extension is supported
   */
  static isSupportedExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.SUPPORTED_EXTENSIONS.includes(ext);
  }

  /**
   * Gets the file type description
   */
  static getFileTypeDescription(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.csv':
        return 'CSV';
      case '.xlsx':
        return 'Excel (XLSX)';
      case '.xls':
        return 'Excel (XLS)';
      default:
        return 'Unknown';
    }
  }
}
