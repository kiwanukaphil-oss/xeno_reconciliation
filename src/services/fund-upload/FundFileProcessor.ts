import { logger } from '../../config/logger';
import { UnifiedFileParser } from './parsers/UnifiedFileParser';
import { FundTransactionValidator } from './validators/FundTransactionValidator';
import { GoalTransactionValidator } from './validators/GoalTransactionValidator';
import { EntityDetector } from './entity-management/EntityDetector';
import { EntityCreator } from './entity-management/EntityCreator';
import { UploadBatchManager } from './database/UploadBatchManager';
import { FundTransactionRepository } from './database/FundTransactionRepository';
import { ParsedFundTransaction } from '../../types/fundTransaction';
import { MaterializedViewService } from '../unit-registry/MaterializedViewService';

/**
 * Main processor for fund transaction file uploads
 * Orchestrates the entire processing pipeline
 */
export class FundFileProcessor {
  /**
   * Processes a fund transaction file upload
   * Main entry point called by the queue worker
   */
  static async processFile(batchId: string, filePath: string): Promise<void> {
    logger.info(`Starting file processing for batch ${batchId}`);

    try {
      // Step 1: Update status to PARSING
      await UploadBatchManager.updateBatchStatus(batchId, 'PARSING');

      // Step 2: Parse file (CSV or Excel)
      logger.info('Step 1: Parsing file');
      const transactions = await UnifiedFileParser.parseFile(filePath);

      if (transactions.length === 0) {
        throw new Error('No valid transactions found in file');
      }

      await UploadBatchManager.updateBatchWithParsingResults(batchId, transactions.length);

      // Step 3: Validate individual transactions
      logger.info('Step 2: Validating individual transactions');
      const validationResult = FundTransactionValidator.validateBatch(transactions);

      // Step 4: Validate goal transaction groups
      logger.info('Step 3: Validating goal transaction groups');
      const groupErrors = GoalTransactionValidator.validateGoalTransactionGroups(
        validationResult.validTransactions
      );

      // Combine all errors
      const allErrors = [...validationResult.allErrors, ...groupErrors];
      const criticalErrors = allErrors.filter((e) => e.severity === 'CRITICAL');
      const warnings = allErrors.filter((e) => e.severity === 'WARNING');

      // Update batch with validation results
      await UploadBatchManager.updateBatchWithValidationResults(batchId, {
        processedRecords: validationResult.validTransactions.length,
        failedRecords: validationResult.invalidTransactions.length,
        validationErrors: criticalErrors,
        validationWarnings: warnings,
        validationStatus: criticalErrors.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'PASSED',
      });

      // Save invalid transactions for audit
      if (validationResult.invalidTransactions.length > 0) {
        await FundTransactionRepository.saveInvalidTransactions(
          validationResult.invalidTransactions,
          batchId
        );
      }

      // CRITICAL: Fail the ENTIRE batch if ANY transactions are invalid
      // This prevents partial uploads which could cause data integrity issues
      if (validationResult.invalidTransactions.length > 0) {
        const invalidCount = validationResult.invalidTransactions.length;
        const totalCount = transactions.length;

        // Build detailed error message with specific row numbers and errors
        const errorDetails = validationResult.invalidTransactions
          .slice(0, 20) // Show first 20 errors
          .map((inv, index) => {
            const rowNum = inv.transaction.rowNumber;
            const errors = inv.errors.map(e => e.message).join('; ');
            return `  ${index + 1}. Row ${rowNum}: ${errors}`;
          })
          .join('\n');

        const moreErrorsMsg = invalidCount > 20
          ? `\n  ... and ${invalidCount - 20} more invalid transactions`
          : '';

        logger.error(`=== BATCH REJECTED: ${invalidCount} of ${totalCount} transactions failed validation ===`);
        logger.error('Invalid transactions:\n' + errorDetails + moreErrorsMsg);

        await UploadBatchManager.updateBatchStatus(batchId, 'FAILED');

        // Include detailed errors in the thrown error message
        throw new Error(
          `Upload rejected: ${invalidCount} of ${totalCount} transactions failed validation.\n\n` +
          `INVALID TRANSACTIONS:\n${errorDetails}${moreErrorsMsg}\n\n` +
          `ALL transactions must be valid before upload can proceed. ` +
          `Please fix the errors and re-upload the entire file.`
        );
      }

      // If there are critical errors in goal transaction validation, fail
      const criticalGroupErrors = groupErrors.filter((e) => e.severity === 'CRITICAL');
      if (criticalGroupErrors.length > 0) {
        logger.error(`Found ${criticalGroupErrors.length} critical goal transaction errors:`);
        criticalGroupErrors.forEach((error, index) => {
          logger.error(`${index + 1}. Row ${error.rowNumber}: ${error.errorCode}`);
          logger.error(`   Message: ${error.message}`);
          logger.error(`   Value: ${JSON.stringify(error.value)}`);
        });

        // Update processing status to FAILED (validation errors already saved above at line 54-60)
        // Don't call updateBatchWithError as it would overwrite the detailed validation errors
        const batch = await UploadBatchManager.getBatch(batchId);
        if (batch) {
          await UploadBatchManager.updateBatchStatus(batchId, 'FAILED');
        }

        throw new Error(
          `Goal transaction validation failed with ${criticalGroupErrors.length} critical errors`
        );
      }

      // Step 5: Detect new entities (clients, accounts, goals)
      logger.info('Step 4: Detecting new entities');
      const newEntitiesReport = await EntityDetector.detectNewEntities(
        validationResult.validTransactions
      );

      // Step 6: If new entities found, pause for approval
      if (EntityDetector.hasNewEntities(newEntitiesReport)) {
        const counts = EntityDetector.getNewEntitiesCount(newEntitiesReport);
        logger.info(
          `New entities detected: ${counts.clients} clients, ${counts.accounts} accounts, ${counts.goals} goals`
        );

        await UploadBatchManager.updateBatchWithNewEntities(batchId, newEntitiesReport);

        logger.info('Processing paused - waiting for entity approval');
        return; // Exit and wait for approval
      }

      // Step 7: No new entities or already approved - save transactions
      await this.finalizeProcessing(batchId, validationResult.validTransactions);
    } catch (error: any) {
      logger.error(`File processing failed for batch ${batchId}:`, error);

      // Don't overwrite detailed errors if they were already saved
      // (e.g., for goal transaction validation errors)
      if (!error.message.includes('Goal transaction validation failed')) {
        await UploadBatchManager.updateBatchWithError(batchId, error);
      }

      throw error;
    }
  }

  /**
   * Resumes processing after entity approval
   */
  static async resumeProcessing(batchId: string, filePath: string): Promise<void> {
    logger.info('=== RESUMING PROCESSING AFTER APPROVAL ===');
    logger.info(`Batch ID: ${batchId}, File path: ${filePath}`);

    try {
      // Get batch details
      const batch = await UploadBatchManager.getBatch(batchId);
      if (!batch) {
        throw new Error(`Batch ${batchId} not found`);
      }

      logger.info(`Batch found, newEntitiesStatus: ${batch.newEntitiesStatus}`);
      if (batch.newEntitiesStatus !== 'APPROVED') {
        throw new Error('Entities have not been approved');
      }

      // Create approved entities
      logger.info('Creating approved entities');
      const newEntitiesReport = batch.newEntitiesReport as any;
      await EntityCreator.createApprovedEntities(newEntitiesReport, batchId);
      logger.info('Approved entities created successfully');

      // Re-parse and validate file
      logger.info('Re-parsing file');
      const transactions = await UnifiedFileParser.parseFile(filePath);
      logger.info(`Parsed ${transactions.length} transactions`);

      const validationResult = FundTransactionValidator.validateBatch(transactions);
      logger.info(`Validation complete: ${validationResult.validTransactions.length} valid, ${validationResult.invalidTransactions.length} invalid`);

      // CRITICAL: Fail if ANY transactions are invalid - no partial uploads allowed
      if (validationResult.invalidTransactions.length > 0) {
        const invalidCount = validationResult.invalidTransactions.length;
        const totalCount = transactions.length;

        logger.error(`=== BATCH REJECTED ON RESUME: ${invalidCount} of ${totalCount} transactions failed validation ===`);

        await UploadBatchManager.updateBatchStatus(batchId, 'FAILED');

        throw new Error(
          `Upload rejected: ${invalidCount} of ${totalCount} transactions failed validation. ` +
          `ALL transactions must be valid before upload can proceed.`
        );
      }

      // Save transactions
      logger.info('Calling finalizeProcessing...');
      await this.finalizeProcessing(batchId, validationResult.validTransactions);
      logger.info('finalizeProcessing completed');
    } catch (error: any) {
      logger.error(`Resume processing failed for batch ${batchId}:`, error);

      // Don't overwrite detailed errors if they were already saved
      if (!error.message.includes('Goal transaction validation failed')) {
        await UploadBatchManager.updateBatchWithError(batchId, error);
      }

      throw error;
    }
  }

  /**
   * Finalizes processing by saving transactions and updating batch
   */
  private static async finalizeProcessing(
    batchId: string,
    transactions: ParsedFundTransaction[]
  ): Promise<void> {
    logger.info('=== ENTERING FINALIZE PROCESSING ===');
    logger.info(`Batch ID: ${batchId}, Transactions to save: ${transactions.length}`);
    logger.info('Step 5: Saving transactions to database');

    // Save transactions
    await FundTransactionRepository.saveTransactions(transactions, batchId);

    // Calculate financial summary
    const financialSummary = FundTransactionRepository.calculateFinancialSummary(transactions);

    // Get goal transaction statistics
    const groupStats = GoalTransactionValidator.getGroupStatistics(transactions);

    // Calculate processing time
    const batch = await UploadBatchManager.getBatch(batchId);
    const processingTime = batch?.processingStartedAt
      ? Date.now() - batch.processingStartedAt.getTime()
      : 0;

    // Update batch with final results
    await UploadBatchManager.updateBatchWithFinalResults(batchId, {
      totalDepositAmount: financialSummary.totalDepositAmount,
      totalWithdrawalAmount: financialSummary.totalWithdrawalAmount,
      totalUnitsIssued: financialSummary.totalUnitsIssued,
      totalUnitsRedeemed: financialSummary.totalUnitsRedeemed,
      totalGoalTransactions: groupStats.totalGroups,
      completeGoalTransactions: groupStats.completeGroups,
      incompleteGoalTransactions: groupStats.incompleteGroups,
      fundBreakdown: financialSummary.fundBreakdown,
      metadata: {
        processingTimeMs: processingTime,
        transactionCount: transactions.length,
        averageFundsPerGoal: groupStats.averageFundsPerGroup.toFixed(2),
      },
    });

    // Refresh all materialized views
    logger.info('=== STARTING MATERIALIZED VIEWS REFRESH ===');
    logger.info(`Batch ID: ${batchId}, Transaction count: ${transactions.length}`);
    try {
      const result = await MaterializedViewService.refreshAllViews();
      if (result.success) {
        logger.info('=== ALL MATERIALIZED VIEWS REFRESHED SUCCESSFULLY ===');
        logger.info(`Refreshed views: ${result.refreshed.join(', ')}`);
        logger.info(`Refresh duration: ${result.duration}ms`);
      } else {
        logger.warn('=== SOME MATERIALIZED VIEWS FAILED TO REFRESH ===');
        logger.warn(`Succeeded: ${result.refreshed.join(', ')}`);
        logger.warn(`Failed: ${result.failed.join(', ')}`);
      }
    } catch (error: any) {
      // Log error but don't fail the upload - views can be refreshed manually
      logger.error('=== MATERIALIZED VIEWS REFRESH FAILED ===');
      logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      logger.warn('Upload completed but materialized views not refreshed - manual refresh may be needed');
    }

    logger.info(`Processing completed successfully for batch ${batchId}`);
    logger.info(`  - Transactions saved: ${transactions.length}`);
    logger.info(`  - Goal transactions: ${groupStats.totalGroups}`);
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
      // Validate headers
      const headerValidation = await UnifiedFileParser.validateHeaders(filePath);
      if (!headerValidation.isValid) {
        errors.push(
          `Missing required columns: ${headerValidation.missingHeaders.join(', ')}`
        );
      }

      // Get row count
      const rowCount = await UnifiedFileParser.getRowCount(filePath);
      if (rowCount === 0) {
        errors.push('File contains no data rows');
      }

      return {
        isValid: errors.length === 0,
        errors,
        rowCount,
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
