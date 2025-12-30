import { PrismaClient, ProcessingStatus, ValidationStatus } from '@prisma/client';
import { logger } from '../../config/logger';
import { BankCSVParser } from './BankCSVParser';
import { BankReconciliationMatcher } from './BankReconciliationMatcher';
import { ParsedBankTransaction, ValidatedBankTransaction } from '../../types/bankTransaction';
import fs from 'fs/promises';

const prisma = new PrismaClient();

/**
 * Result of bank upload queue operation (immediate response)
 */
export interface BankUploadQueueResult {
  batchId: string;
  batchNumber: string;
  status: string;
  message: string;
}

/**
 * Result of bank upload processing (after background processing completes)
 */
export interface BankUploadResult {
  batchId: string;
  batchNumber: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  totalMatched: number;
  totalUnmatched: number;
  totalVariances: number;
  autoApprovedCount: number;
  manualReviewCount: number;
  errors: string[];
}

/**
 * Bank Reconciliation Service
 * Handles bank transaction uploads and reconciliation with fund system
 */
export class BankReconciliationService {
  private matcher: BankReconciliationMatcher;

  constructor() {
    this.matcher = new BankReconciliationMatcher();
  }

  /**
   * Uploads and saves bank transactions (Step 1 - just save, no reconciliation)
   * Reconciliation is done separately via reconcilePeriod()
   */
  async uploadBankTransactions(
    filePath: string,
    fileName: string,
    uploadedBy: string,
    metadata?: any
  ): Promise<BankUploadQueueResult> {
    try {
      logger.info(`Processing bank upload: ${fileName}`);

      // Validate file structure
      const structureValidation = await BankCSVParser.validateFileStructure(filePath);
      if (!structureValidation.valid) {
        throw new Error(
          `Invalid file structure: ${structureValidation.errors.join(', ')}`
        );
      }

      // Get file stats
      const stats = await fs.stat(filePath);

      // Create upload batch
      const batch = await prisma.bankUploadBatch.create({
        data: {
          batchNumber: await this.generateBatchNumber(),
          fileName,
          fileSize: BigInt(stats.size),
          filePath,
          processingStatus: ProcessingStatus.PARSING,
          validationStatus: ValidationStatus.PENDING,
          uploadedBy,
          metadata: metadata || {},
        },
      });

      logger.info(`Created bank upload batch: ${batch.batchNumber} (${batch.id})`);

      // Parse CSV file
      const parsedTransactions = await BankCSVParser.parseFile(filePath);
      logger.info(`Parsed ${parsedTransactions.length} bank transactions`);

      // Update batch with total records
      await prisma.bankUploadBatch.update({
        where: { id: batch.id },
        data: {
          totalRecords: parsedTransactions.length,
          processingStatus: ProcessingStatus.VALIDATING,
        },
      });

      // Validate and save transactions (without reconciliation)
      const savedCount = await this.saveBankTransactions(parsedTransactions, batch.id);

      // Update batch status to completed
      await prisma.bankUploadBatch.update({
        where: { id: batch.id },
        data: {
          processingStatus: ProcessingStatus.COMPLETED,
          processedRecords: savedCount,
          processingCompletedAt: new Date(),
        },
      });

      logger.info(`Bank upload completed: ${batch.batchNumber} - ${savedCount} transactions saved`);

      return {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        status: 'COMPLETED',
        message: `Successfully uploaded ${savedCount} bank transactions. Use the Reconcile feature to match with fund transactions.`,
      };
    } catch (error) {
      logger.error('Error processing bank upload:', error);
      throw error;
    }
  }

  /**
   * Saves bank transactions without reconciliation
   */
  private async saveBankTransactions(
    transactions: ParsedBankTransaction[],
    batchId: string
  ): Promise<number> {
    const BATCH_SIZE = 500;
    let savedCount = 0;

    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);

      // Resolve entity IDs and save
      for (const transaction of batch) {
        try {
          // Find account
          const account = await prisma.account.findUnique({
            where: { accountNumber: transaction.accountNumber },
          });

          if (!account) {
            logger.warn(`Row ${transaction.rowNumber}: Account not found: ${transaction.accountNumber}`);
            continue;
          }

          // Find goal
          const goal = await prisma.goal.findUnique({
            where: { goalNumber: transaction.goalNumber },
          });

          if (!goal) {
            logger.warn(`Row ${transaction.rowNumber}: Goal not found: ${transaction.goalNumber}`);
            continue;
          }

          // Save bank transaction (without reconciliation status)
          await prisma.bankGoalTransaction.create({
            data: {
              clientId: account.clientId,
              accountId: account.id,
              goalId: goal.id,
              uploadBatchId: batchId,
              transactionDate: transaction.transactionDate,
              transactionType: transaction.transactionType as any,
              transactionId: transaction.transactionId,
              firstName: transaction.firstName,
              lastName: transaction.lastName,
              goalTitle: transaction.goalTitle,
              goalNumber: transaction.goalNumber,
              totalAmount: transaction.totalAmount,
              xummfPercentage: transaction.xummfPercentage / 100,
              xubfPercentage: transaction.xubfPercentage / 100,
              xudefPercentage: transaction.xudefPercentage / 100,
              xurefPercentage: transaction.xurefPercentage / 100,
              xummfAmount: transaction.xummfAmount,
              xubfAmount: transaction.xubfAmount,
              xudefAmount: transaction.xudefAmount,
              xurefAmount: transaction.xurefAmount,
              reconciliationStatus: 'PENDING', // Will be updated during reconciliation
              rowNumber: transaction.rowNumber,
            },
          });

          savedCount++;
        } catch (error) {
          logger.error(`Row ${transaction.rowNumber}: Error saving:`, error);
        }
      }

      logger.info(`Saved batch: ${savedCount}/${transactions.length}`);
    }

    return savedCount;
  }

  /**
   * Processes a bank transaction upload file (called by worker)
   */
  async processUpload(batchId: string, filePath: string): Promise<BankUploadResult> {
    try {
      logger.info(`Starting bank upload processing for batch: ${batchId}`);

      // Update status to PARSING
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: { processingStatus: ProcessingStatus.PARSING },
      });

      // Parse CSV file
      const parsedTransactions = await BankCSVParser.parseFile(filePath);
      logger.info(`Parsed ${parsedTransactions.length} bank transactions`);

      // Update batch with total records
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: {
          totalRecords: parsedTransactions.length,
          processingStatus: ProcessingStatus.VALIDATING,
        },
      });

      // Validate and resolve entity IDs
      const validatedTransactions = await this.validateTransactions(
        parsedTransactions,
        batchId
      );

      // Update batch status
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: {
          processingStatus: ProcessingStatus.PROCESSING,
          validationStatus: ValidationStatus.PASSED,
          processingStartedAt: new Date(),
        },
      });

      // Process and match transactions in batches
      const result = await this.processTransactionsInBatches(
        validatedTransactions,
        batchId
      );

      // Get batch for batchNumber
      const batch = await prisma.bankUploadBatch.findUnique({
        where: { id: batchId },
      });

      // Update batch with final statistics
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: {
          processingStatus: ProcessingStatus.COMPLETED,
          processingCompletedAt: new Date(),
          processedRecords: result.processedRecords,
          failedRecords: result.failedRecords,
          totalMatched: result.totalMatched,
          totalUnmatched: result.totalUnmatched,
          totalVariances: result.totalVariances,
          autoApprovedCount: result.autoApprovedCount,
          manualReviewCount: result.manualReviewCount,
          totalAmount: validatedTransactions.reduce(
            (sum, t) => sum + t.totalAmount,
            0
          ),
        },
      });

      logger.info(`Bank upload processing completed: ${batch?.batchNumber}`);

      return {
        batchId,
        batchNumber: batch?.batchNumber || '',
        totalRecords: parsedTransactions.length,
        ...result,
      };
    } catch (error) {
      logger.error('Error processing bank upload:', error);

      // Update batch status to failed
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: {
          processingStatus: ProcessingStatus.FAILED,
          validationStatus: ValidationStatus.FAILED,
          validationErrors: [
            {
              message: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      });

      throw error;
    }
  }

  /**
   * Validates transactions and resolves entity IDs
   */
  private async validateTransactions(
    transactions: ParsedBankTransaction[],
    batchId: string
  ): Promise<ValidatedBankTransaction[]> {
    const validated: ValidatedBankTransaction[] = [];
    const errors: any[] = [];

    for (const transaction of transactions) {
      try {
        // Find client by account number
        const account = await prisma.account.findUnique({
          where: { accountNumber: transaction.accountNumber },
          include: { client: true },
        });

        if (!account) {
          errors.push({
            rowNumber: transaction.rowNumber,
            error: `Account not found: ${transaction.accountNumber}`,
          });
          continue;
        }

        // Find goal by goal number
        const goal = await prisma.goal.findUnique({
          where: { goalNumber: transaction.goalNumber },
        });

        if (!goal) {
          errors.push({
            rowNumber: transaction.rowNumber,
            error: `Goal not found: ${transaction.goalNumber}`,
          });
          continue;
        }

        // Verify goal belongs to account
        if (goal.accountId !== account.id) {
          errors.push({
            rowNumber: transaction.rowNumber,
            error: `Goal ${transaction.goalNumber} does not belong to account ${transaction.accountNumber}`,
          });
          continue;
        }

        validated.push({
          ...transaction,
          clientId: account.clientId,
          accountId: account.id,
          goalId: goal.id,
        });
      } catch (error) {
        logger.error(`Error validating transaction row ${transaction.rowNumber}:`, error);
        errors.push({
          rowNumber: transaction.rowNumber,
          error: error instanceof Error ? error.message : 'Validation error',
        });
      }
    }

    // Save validation errors if any
    if (errors.length > 0) {
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: {
          validationErrors: errors,
          failedRecords: errors.length,
        },
      });
    }

    logger.info(
      `Validated ${validated.length} transactions, ${errors.length} failed`
    );

    return validated;
  }

  /**
   * Processes validated transactions in batches - matches and saves to database
   * Uses batch processing to avoid timeouts on large datasets
   */
  private async processTransactionsInBatches(
    transactions: ValidatedBankTransaction[],
    batchId: string
  ): Promise<{
    processedRecords: number;
    failedRecords: number;
    totalMatched: number;
    totalUnmatched: number;
    totalVariances: number;
    autoApprovedCount: number;
    manualReviewCount: number;
    errors: string[];
  }> {
    const BATCH_SIZE = 100; // Process 100 transactions at a time
    let processedRecords = 0;
    let failedRecords = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalVariances = 0;
    let autoApprovedCount = 0;
    let manualReviewCount = 0;
    const errors: string[] = [];

    const totalBatches = Math.ceil(transactions.length / BATCH_SIZE);
    logger.info(`Processing ${transactions.length} transactions in ${totalBatches} batches`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, transactions.length);
      const batch = transactions.slice(start, end);

      logger.info(`Processing batch ${batchIndex + 1}/${totalBatches} (rows ${start + 1}-${end})`);

      // Update batch progress
      await prisma.bankUploadBatch.update({
        where: { id: batchId },
        data: {
          processedRecords,
          metadata: {
            currentBatch: batchIndex + 1,
            totalBatches,
            progress: Math.round((processedRecords / transactions.length) * 100),
          },
        },
      });

      for (const transaction of batch) {
        try {
          // Match with fund transactions
          const matchResult = await this.matcher.matchTransaction(transaction);

          // Save bank goal transaction
          await prisma.bankGoalTransaction.create({
            data: {
              clientId: transaction.clientId,
              accountId: transaction.accountId,
              goalId: transaction.goalId,
              uploadBatchId: batchId,
              transactionDate: transaction.transactionDate,
              transactionType: transaction.transactionType as any,
              transactionId: transaction.transactionId,
              firstName: transaction.firstName,
              lastName: transaction.lastName,
              goalTitle: transaction.goalTitle,
              goalNumber: transaction.goalNumber,
              totalAmount: transaction.totalAmount,
              xummfPercentage: transaction.xummfPercentage / 100,
              xubfPercentage: transaction.xubfPercentage / 100,
              xudefPercentage: transaction.xudefPercentage / 100,
              xurefPercentage: transaction.xurefPercentage / 100,
              xummfAmount: transaction.xummfAmount,
              xubfAmount: transaction.xubfAmount,
              xudefAmount: transaction.xudefAmount,
              xurefAmount: transaction.xurefAmount,
              reconciliationStatus: matchResult.status,
              matchedGoalTransactionCode: matchResult.goalTransactionCode,
              matchedAt: matchResult.matched ? new Date() : null,
              matchScore: matchResult.matchScore,
              rowNumber: transaction.rowNumber,
            },
          });

          processedRecords++;
          if (matchResult.matched) totalMatched++;
          else totalUnmatched++;
          totalVariances += matchResult.variances.length;
          if (matchResult.autoApproved) autoApprovedCount++;
          else if (matchResult.matched) manualReviewCount++;
        } catch (error) {
          failedRecords++;
          const errorMsg = `Row ${transaction.rowNumber}: ${
            error instanceof Error ? error.message : 'Processing error'
          }`;
          errors.push(errorMsg);
          logger.error(errorMsg, error);
        }
      }

      logger.info(`Batch ${batchIndex + 1}/${totalBatches} completed. Progress: ${processedRecords}/${transactions.length}`);
    }

    return {
      processedRecords,
      failedRecords,
      totalMatched,
      totalUnmatched,
      totalVariances,
      autoApprovedCount,
      manualReviewCount,
      errors,
    };
  }

  /**
   * Gets batch status for polling
   */
  async getBatchStatus(batchId: string): Promise<{
    id: string;
    batchNumber: string;
    status: string;
    progress: number;
    totalRecords: number;
    processedRecords: number;
    failedRecords: number;
    totalMatched: number;
    totalUnmatched: number;
    errors: any[];
  }> {
    const batch = await prisma.bankUploadBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    const metadata = (batch.metadata as any) || {};
    const progress = batch.totalRecords > 0
      ? Math.round((batch.processedRecords / batch.totalRecords) * 100)
      : 0;

    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.processingStatus,
      progress: metadata.progress || progress,
      totalRecords: batch.totalRecords,
      processedRecords: batch.processedRecords,
      failedRecords: batch.failedRecords,
      totalMatched: batch.totalMatched,
      totalUnmatched: batch.totalUnmatched,
      errors: (batch.validationErrors as any[]) || [],
    };
  }

  /**
   * Generates a unique batch number
   */
  private async generateBatchNumber(): Promise<string> {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

    // Count batches created today
    const todayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayEnd = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      23,
      59,
      59
    );

    const count = await prisma.bankUploadBatch.count({
      where: {
        uploadedAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    });

    const sequence = String(count + 1).padStart(5, '0');
    return `BANK-BATCH-${dateStr}-${sequence}`;
  }

  /**
   * Gets reconciliation summary for a batch
   */
  async getBatchSummary(batchId: string): Promise<any> {
    const batch = await prisma.bankUploadBatch.findUnique({
      where: { id: batchId },
      include: {
        bankGoalTransactions: true,
      },
    });

    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    return {
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        fileName: batch.fileName,
        processingStatus: batch.processingStatus,
        totalRecords: batch.totalRecords,
        processedRecords: batch.processedRecords,
        failedRecords: batch.failedRecords,
        totalMatched: batch.totalMatched,
        totalUnmatched: batch.totalUnmatched,
        totalVariances: batch.totalVariances,
        autoApprovedCount: batch.autoApprovedCount,
        manualReviewCount: batch.manualReviewCount,
        uploadedAt: batch.uploadedAt,
        uploadedBy: batch.uploadedBy,
      },
      transactions: batch.bankGoalTransactions.map((t) => ({
        id: t.id,
        goalNumber: t.goalNumber,
        transactionId: t.transactionId,
        transactionDate: t.transactionDate,
        totalAmount: t.totalAmount,
        reconciliationStatus: t.reconciliationStatus,
        matchScore: t.matchScore,
      })),
    };
  }

  /**
   * Gets detailed reconciliation report
   */
  async getReconciliationReport(batchId: string): Promise<any> {
    const batch = await prisma.bankUploadBatch.findUnique({
      where: { id: batchId },
      include: {
        bankGoalTransactions: {
          include: {
            client: true,
            account: true,
            goal: true,
          },
        },
      },
    });

    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    return {
      batchInfo: {
        batchNumber: batch.batchNumber,
        fileName: batch.fileName,
        uploadedAt: batch.uploadedAt,
        uploadedBy: batch.uploadedBy,
        processingStatus: batch.processingStatus,
      },
      summary: {
        totalRecords: batch.totalRecords,
        matched: batch.totalMatched,
        unmatched: batch.totalUnmatched,
        autoApproved: batch.autoApprovedCount,
        manualReview: batch.manualReviewCount,
        totalVariances: batch.totalVariances,
      },
      transactions: batch.bankGoalTransactions.map((t) => ({
        rowNumber: t.rowNumber,
        client: t.client.clientName,
        accountNumber: t.account.accountNumber,
        goalNumber: t.goalNumber,
        transactionId: t.transactionId,
        transactionDate: t.transactionDate,
        totalAmount: t.totalAmount,
        status: t.reconciliationStatus,
        matchScore: t.matchScore,
        matchedCode: t.matchedGoalTransactionCode,
      })),
    };
  }
}
