import { logger } from '../../config/logger';
import { BankCSVParser } from './parsers/BankCSVParser';
import { BankTransactionValidator } from './validators/BankTransactionValidator';
import { BankUploadBatchManager } from './database/BankUploadBatchManager';
import { BankTransactionRepository } from './database/BankTransactionRepository';
import { ParsedBankTransaction } from '../../types/bankTransaction';

/**
 * Main processor for bank transaction file uploads
 * Orchestrates the entire processing pipeline
 * Mirrors FundFileProcessor for consistency
 */
export class BankFileProcessor {
  /**
   * Processes a bank transaction file upload
   * Main entry point called by the queue worker
   */
  static async processFile(batchId: string, filePath: string): Promise<void> {
    logger.info(`Starting bank file processing for batch ${batchId}`);

    try {
      // Step 1: Update status to PARSING
      await BankUploadBatchManager.updateBatchStatus(batchId, 'PARSING');

      // Step 2: Parse CSV file
      logger.info('Step 1: Parsing bank file');
      const transactions = await BankCSVParser.parseFile(filePath);

      if (transactions.length === 0) {
        throw new Error('No valid transactions found in file');
      }

      await BankUploadBatchManager.updateBatchWithParsingResults(batchId, transactions.length);

      // Step 3: Validate transactions
      logger.info('Step 2: Validating bank transactions');
      await BankUploadBatchManager.updateBatchStatus(batchId, 'VALIDATING');

      const validationResult = await BankTransactionValidator.validateBatch(transactions);

      // Get validation statistics - only CRITICAL errors block upload
      const criticalErrors = validationResult.allErrors.filter((e) => e.severity === 'CRITICAL');
      const warnings = validationResult.allErrors.filter((e) => e.severity === 'WARNING' || e.severity === 'INFO');

      // Update batch with validation results
      await BankUploadBatchManager.updateBatchWithValidationResults(batchId, {
        processedRecords: validationResult.validTransactions.length,
        failedRecords: validationResult.invalidTransactions.length,
        validationErrors: criticalErrors,
        validationWarnings: warnings,
        validationStatus: criticalErrors.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'PASSED',
        transactionsWithWarnings: validationResult.transactionsWithWarnings.length,
      });

      // Only fail batch if there are transactions with CRITICAL errors
      if (validationResult.invalidTransactions.length > 0) {
        const invalidCount = validationResult.invalidTransactions.length;
        const totalCount = transactions.length;

        // Build detailed error message showing only CRITICAL errors
        const errorDetails = validationResult.invalidTransactions
          .slice(0, 20)
          .map((inv, index) => {
            const rowNum = inv.transaction.rowNumber;
            const errors = inv.errors.map((e) => e.message).join('; ');
            return `  ${index + 1}. Row ${rowNum}: ${errors}`;
          })
          .join('\n');

        const moreErrorsMsg =
          invalidCount > 20 ? `\n  ... and ${invalidCount - 20} more invalid transactions` : '';

        logger.error(
          `=== BANK BATCH REJECTED: ${invalidCount} of ${totalCount} transactions have CRITICAL errors ===`
        );
        logger.error('Invalid transactions:\n' + errorDetails + moreErrorsMsg);

        await BankUploadBatchManager.updateBatchStatus(batchId, 'FAILED');

        throw new Error(
          `Upload rejected: ${invalidCount} of ${totalCount} transactions have CRITICAL errors.\n\n` +
            `INVALID TRANSACTIONS:\n${errorDetails}${moreErrorsMsg}\n\n` +
            `Fix CRITICAL errors and re-upload. Note: Warnings (like percentage/amount mismatches) do NOT block uploads.`
        );
      }

      // Log warnings for reconciliation tracking (but don't block upload)
      if (validationResult.transactionsWithWarnings.length > 0) {
        logger.warn(
          `${validationResult.transactionsWithWarnings.length} transactions have warnings ` +
            `(percentage/amount mismatches) - these will be tracked for reconciliation`
        );
      }

      // Step 4: Save transactions to database
      logger.info('Step 3: Saving transactions to database');
      await this.finalizeProcessing(batchId, validationResult.validTransactions);
    } catch (error: any) {
      logger.error(`Bank file processing failed for batch ${batchId}:`, error);
      await BankUploadBatchManager.updateBatchWithError(batchId, error);
      throw error;
    }
  }

  /**
   * Finalizes processing by saving transactions and updating batch
   */
  private static async finalizeProcessing(
    batchId: string,
    transactions: ParsedBankTransaction[]
  ): Promise<void> {
    logger.info('=== ENTERING BANK FINALIZE PROCESSING ===');
    logger.info(`Batch ID: ${batchId}, Transactions to save: ${transactions.length}`);

    // Save transactions
    const savedCount = await BankTransactionRepository.saveTransactions(transactions, batchId);

    // Calculate financial summary
    const financialSummary = BankTransactionRepository.calculateFinancialSummary(transactions);

    // Calculate processing time
    const batch = await BankUploadBatchManager.getBatch(batchId);
    const processingTime = batch?.processingStartedAt
      ? Date.now() - batch.processingStartedAt.getTime()
      : 0;

    // Update batch with final results
    await BankUploadBatchManager.updateBatchWithFinalResults(batchId, {
      totalAmount: financialSummary.totalAmount,
      processedRecords: savedCount,
      metadata: {
        processingTimeMs: processingTime,
        transactionCount: transactions.length,
        savedCount,
        depositCount: financialSummary.depositCount,
        withdrawalCount: financialSummary.withdrawalCount,
        totalDeposits: financialSummary.totalDeposits,
        totalWithdrawals: financialSummary.totalWithdrawals,
      },
    });

    logger.info(`Bank processing completed successfully for batch ${batchId}`);
    logger.info(`  - Transactions saved: ${savedCount}`);
    logger.info(`  - Processing time: ${(processingTime / 1000).toFixed(2)}s`);
  }

  /**
   * Validates file before processing
   */
  static async validateFile(filePath: string): Promise<{
    isValid: boolean;
    errors: string[];
    rowCount?: number;
  }> {
    const errors: string[] = [];

    try {
      // Validate file structure
      const structureValidation = await BankCSVParser.validateFileStructure(filePath);

      if (!structureValidation.valid) {
        errors.push(...structureValidation.errors);
      }

      return {
        isValid: errors.length === 0,
        errors,
        rowCount: structureValidation.rowCount,
      };
    } catch (error: any) {
      errors.push(`File validation error: ${error.message}`);
      return {
        isValid: false,
        errors,
      };
    }
  }
}
