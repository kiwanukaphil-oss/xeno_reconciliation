import path from 'path';
import { logger } from '../../../config/logger';
import { FundCSVParser } from './FundCSVParser';
import { ExcelParser } from './ExcelParser';
import { ParsedFundTransaction } from '../../../types/fundTransaction';

/**
 * Unified file parser that handles both CSV and Excel files
 */
export class UnifiedFileParser {
  /**
   * Parses a file (auto-detects CSV or Excel based on extension)
   */
  static async parseFile(filePath: string): Promise<ParsedFundTransaction[]> {
    const ext = path.extname(filePath).toLowerCase();

    logger.info(`Parsing file with extension: ${ext}`);

    switch (ext) {
      case '.csv':
        return await FundCSVParser.parseFile(filePath);

      case '.xlsx':
      case '.xls':
        return await ExcelParser.parseFile(filePath);

      default:
        throw new Error(`Unsupported file type: ${ext}. Supported types: .csv, .xlsx, .xls`);
    }
  }

  /**
   * Validates file headers (auto-detects file type)
   */
  static async validateHeaders(
    filePath: string
  ): Promise<{
    isValid: boolean;
    missingHeaders: string[];
    extraHeaders: string[];
  }> {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.csv':
        return await FundCSVParser.validateHeaders(filePath);

      case '.xlsx':
      case '.xls':
        return ExcelParser.validateHeaders(filePath);

      default:
        return {
          isValid: false,
          missingHeaders: [],
          extraHeaders: [],
        };
    }
  }

  /**
   * Gets row count from file (auto-detects file type)
   */
  static async getRowCount(filePath: string): Promise<number> {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.csv':
        return await FundCSVParser.getRowCount(filePath);

      case '.xlsx':
      case '.xls':
        return ExcelParser.getRowCount(filePath);

      default:
        return 0;
    }
  }

  /**
   * Checks if file type is supported
   */
  static isSupportedFileType(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.csv', '.xlsx', '.xls'].includes(ext);
  }

  /**
   * Gets supported file extensions
   */
  static getSupportedExtensions(): string[] {
    return ['.csv', '.xlsx', '.xls'];
  }
}
