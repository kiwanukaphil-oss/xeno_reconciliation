import { PrismaClient, ProcessingStatus, ValidationStatus } from '@prisma/client';
import { logger } from '../../config/logger';
import { BankCSVParser } from './BankCSVParser';
import { BankReconciliationMatcher, MatchResult } from './BankReconciliationMatcher';
import { ParsedBankTransaction, ValidatedBankTransaction } from '../../types/bankTransaction';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

/**
 * Result of bank upload processing
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
   * Processes a bank transaction upload file
   */
  async processUpload(
    filePath: string,
    fileName: string,
    uploadedBy: string,
    metadata?: any
  ): Promise<BankUploadResult> {
    let batchId: string | null = null;

    try {
      logger.info(`Starting bank upload processing: ${fileName}`);

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

      batchId = batch.id;
      logger.info(`Created bank upload batch: ${batch.batchNumber} (${batchId})`);

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

      // Process and match transactions
      const result = await this.processTransactions(
        validatedTransactions,
        batchId
      );

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

      logger.info(`Bank upload processing completed: ${batch.batchNumber}`);

      return {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        ...result,
      };
    } catch (error) {
      logger.error('Error processing bank upload:', error);

      // Update batch status to failed
      if (batchId) {
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
      }

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
   * Processes validated transactions - matches and saves to database
   */
  private async processTransactions(
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
    let processedRecords = 0;
    let failedRecords = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalVariances = 0;
    let autoApprovedCount = 0;
    let manualReviewCount = 0;
    const errors: string[] = [];

    for (const transaction of transactions) {
      try {
        // Match with fund transactions
        const matchResult = await this.matcher.matchTransaction(transaction);

        // Save bank goal transaction
        const bankGoalTransaction = await prisma.bankGoalTransaction.create({
          data: {
            clientId: transaction.clientId,
            accountId: transaction.accountId,
            goalId: transaction.goalId,
            uploadBatchId: batchId,
            transactionDate: transaction.transactionDate,
            transactionType: transaction.transactionType,
            transactionId: transaction.transactionId,
            firstName: transaction.firstName,
            lastName: transaction.lastName,
            goalTitle: transaction.goalTitle,
            goalNumber: transaction.goalNumber,
            totalAmount: transaction.totalAmount,
            xummfPercentage: transaction.fundPercentages.XUMMF,
            xubfPercentage: transaction.fundPercentages.XUBF,
            xudefPercentage: transaction.fundPercentages.XUDEF,
            xurefPercentage: transaction.fundPercentages.XUREF,
            xummfAmount: transaction.fundAmounts.XUMMF,
            xubfAmount: transaction.fundAmounts.XUBF,
            xudefAmount: transaction.fundAmounts.XUDEF,
            xurefAmount: transaction.fundAmounts.XUREF,
            reconciliationStatus: matchResult.status,
            matchedGoalTransactionCode: matchResult.goalTransactionCode,
            matchedAt: matchResult.matched ? new Date() : null,
            matchScore: matchResult.matchScore,
            rowNumber: transaction.rowNumber,
          },
        });

        // Save variances
        for (const variance of matchResult.variances) {
          await prisma.reconciliationVariance.create({
            data: {
              bankGoalTransactionId: bankGoalTransaction.id,
              varianceType: variance.type,
              varianceSeverity: variance.severity,
              description: variance.description,
              expectedValue: variance.expectedValue,
              actualValue: variance.actualValue,
              differenceAmount: variance.differenceAmount,
              differencePercentage: variance.differencePercentage,
              fundCode: variance.fundCode,
              fundExpectedAmount: variance.fundExpectedAmount,
              fundActualAmount: variance.fundActualAmount,
              expectedDate: variance.expectedDate,
              actualDate: variance.actualDate,
              dateDifferenceDays: variance.dateDifferenceDays,
              autoApproved: variance.autoApproved,
              autoApprovalReason: variance.autoApprovalReason,
              resolutionStatus: variance.autoApproved ? 'AUTO_APPROVED' : 'PENDING',
            },
          });
        }

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
        bankGoalTransactions: {
          include: {
            variances: true,
          },
        },
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
        varianceCount: t.variances.length,
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
            variances: true,
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
        variances: t.variances.map((v) => ({
          type: v.varianceType,
          severity: v.varianceSeverity,
          description: v.description,
          difference: v.differenceAmount,
          autoApproved: v.autoApproved,
        })),
      })),
    };
  }
}
