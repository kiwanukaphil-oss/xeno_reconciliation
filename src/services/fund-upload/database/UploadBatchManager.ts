import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { Prisma } from '@prisma/client';
import { NewEntitiesReport } from '../../../types/fundTransaction';

/**
 * Manages upload batch database operations
 */
export class UploadBatchManager {
  /**
   * Creates a new upload batch
   */
  static async createUploadBatch(data: {
    fileName: string;
    fileSize: number;
    filePath: string;
    uploadedBy: string;
  }): Promise<string> {
    const batchNumber = this.generateBatchNumber();

    const batch = await prisma.uploadBatch.create({
      data: {
        batchNumber,
        fileName: data.fileName,
        fileSize: BigInt(data.fileSize),
        filePath: data.filePath,
        processingStatus: 'QUEUED',
        validationStatus: 'PENDING',
        uploadedBy: data.uploadedBy,
        uploadedAt: new Date(),
      },
    });

    logger.info(`Upload batch created: ${batchNumber} (${batch.id})`);

    return batch.id;
  }

  /**
   * Updates batch status
   */
  static async updateBatchStatus(
    batchId: string,
    processingStatus: string,
    validationStatus?: string
  ): Promise<void> {
    const updateData: any = {
      processingStatus,
    };

    if (validationStatus) {
      updateData.validationStatus = validationStatus;
    }

    if (processingStatus === 'PARSING') {
      updateData.processingStartedAt = new Date();
    } else if (processingStatus === 'COMPLETED' || processingStatus === 'FAILED') {
      updateData.processingCompletedAt = new Date();
    }

    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: updateData,
    });

    logger.info(`Batch ${batchId} status updated: ${processingStatus}`);
  }

  /**
   * Updates batch with parsing results
   */
  static async updateBatchWithParsingResults(
    batchId: string,
    totalRecords: number
  ): Promise<void> {
    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        totalRecords,
        processingStatus: 'VALIDATING',
      },
    });
  }

  /**
   * Updates batch with validation results
   */
  static async updateBatchWithValidationResults(
    batchId: string,
    data: {
      processedRecords: number;
      failedRecords: number;
      validationErrors?: any;
      validationWarnings?: any;
      validationStatus: string;
    }
  ): Promise<void> {
    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        processedRecords: data.processedRecords,
        failedRecords: data.failedRecords,
        validationErrors: data.validationErrors,
        validationWarnings: data.validationWarnings,
        validationStatus: data.validationStatus as any,
        processingStatus: 'PROCESSING',
      },
    });
  }

  /**
   * Updates batch with new entities report
   */
  static async updateBatchWithNewEntities(
    batchId: string,
    report: NewEntitiesReport
  ): Promise<void> {
    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        newClientsDetected: report.clients.length,
        newAccountsDetected: report.accounts.length,
        newGoalsDetected: report.goals.length,
        newEntitiesReport: report as any,
        newEntitiesStatus: 'PENDING',
        processingStatus: 'WAITING_FOR_APPROVAL',
      },
    });

    logger.info(`Batch ${batchId} waiting for entity approval`);
  }

  /**
   * Updates batch after entity approval
   */
  static async updateBatchAfterApproval(
    batchId: string,
    approvalStatus: 'APPROVED' | 'REJECTED',
    approvedBy: string
  ): Promise<void> {
    const updateData: any = {
      newEntitiesStatus: approvalStatus,
      approvedBy,
      approvedAt: new Date(),
    };

    if (approvalStatus === 'APPROVED') {
      updateData.processingStatus = 'PROCESSING';
    } else {
      updateData.processingStatus = 'FAILED';
      updateData.processingCompletedAt = new Date();
    }

    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: updateData,
    });

    logger.info(`Batch ${batchId} entity approval: ${approvalStatus}`);
  }

  /**
   * Updates batch with final processing results
   */
  static async updateBatchWithFinalResults(
    batchId: string,
    data: {
      totalDepositAmount: number;
      totalWithdrawalAmount: number;
      totalUnitsIssued: number;
      totalUnitsRedeemed: number;
      totalGoalTransactions: number;
      completeGoalTransactions: number;
      incompleteGoalTransactions: number;
      fundBreakdown: any;
      metadata?: any;
    }
  ): Promise<void> {
    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        totalDepositAmount: new Prisma.Decimal(data.totalDepositAmount),
        totalWithdrawalAmount: new Prisma.Decimal(data.totalWithdrawalAmount),
        totalUnitsIssued: new Prisma.Decimal(data.totalUnitsIssued),
        totalUnitsRedeemed: new Prisma.Decimal(data.totalUnitsRedeemed),
        totalGoalTransactions: data.totalGoalTransactions,
        completeGoalTransactions: data.completeGoalTransactions,
        incompleteGoalTransactions: data.incompleteGoalTransactions,
        fundBreakdown: data.fundBreakdown,
        metadata: data.metadata,
        processingStatus: 'COMPLETED',
        validationStatus: 'PASSED',
        processingCompletedAt: new Date(),
      },
    });

    logger.info(`Batch ${batchId} processing completed`);
  }

  /**
   * Updates batch with error
   */
  static async updateBatchWithError(
    batchId: string,
    error: Error,
    validationErrors?: any
  ): Promise<void> {
    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        processingStatus: 'FAILED',
        validationStatus: 'FAILED',
        validationErrors: validationErrors || { error: error.message },
        processingCompletedAt: new Date(),
      },
    });

    logger.error(`Batch ${batchId} failed:`, error);
  }

  /**
   * Gets batch details
   */
  static async getBatch(batchId: string) {
    return await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });
  }

  /**
   * Gets batch summary (converts BigInt to number for JSON serialization)
   */
  static async getBatchSummary(batchId: string) {
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      return null;
    }

    return {
      ...batch,
      fileSize: Number(batch.fileSize),
      totalDepositAmount: batch.totalDepositAmount.toNumber(),
      totalWithdrawalAmount: batch.totalWithdrawalAmount.toNumber(),
      totalUnitsIssued: batch.totalUnitsIssued.toNumber(),
      totalUnitsRedeemed: batch.totalUnitsRedeemed.toNumber(),
    };
  }

  /**
   * Gets all batches with pagination
   */
  static async getAllBatches(options: {
    page?: number;
    limit?: number;
  } = {}): Promise<{
    batches: any[];
    total: number;
    page: number;
    limit: number;
    pages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const [batches, total] = await Promise.all([
      prisma.uploadBatch.findMany({
        orderBy: {
          uploadedAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          batchNumber: true,
          fileName: true,
          fileSize: true,
          filePath: true,
          processingStatus: true,
          validationStatus: true,
          totalRecords: true,
          processedRecords: true,
          failedRecords: true,
          newClientsDetected: true,
          newAccountsDetected: true,
          newGoalsDetected: true,
          newEntitiesStatus: true,
          totalDepositAmount: true,
          totalWithdrawalAmount: true,
          totalUnitsIssued: true,
          totalUnitsRedeemed: true,
          totalGoalTransactions: true,
          completeGoalTransactions: true,
          incompleteGoalTransactions: true,
          uploadedAt: true,
          processingStartedAt: true,
          processingCompletedAt: true,
          uploadedBy: true,
          approvedBy: true,
          approvedAt: true,
          metadata: true,
          // Exclude large JSON fields that can cause serialization issues
          // validationErrors: false,
          // validationWarnings: false,
          // newEntitiesReport: false,
          // fundBreakdown: false,
        },
      }),
      prisma.uploadBatch.count(),
    ]);

    // Convert BigInt and Decimal fields to numbers for JSON serialization
    const formattedBatches = batches.map((batch) => ({
      ...batch,
      fileSize: Number(batch.fileSize),
      totalDepositAmount: batch.totalDepositAmount.toNumber(),
      totalWithdrawalAmount: batch.totalWithdrawalAmount.toNumber(),
      totalUnitsIssued: batch.totalUnitsIssued.toNumber(),
      totalUnitsRedeemed: batch.totalUnitsRedeemed.toNumber(),
    }));

    return {
      batches: formattedBatches,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Cancels a batch
   */
  static async cancelBatch(batchId: string): Promise<void> {
    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        processingStatus: 'CANCELED',
        processingCompletedAt: new Date(),
      },
    });

    logger.info(`Batch ${batchId} canceled`);
  }

  /**
   * Generates a unique batch number
   */
  private static generateBatchNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 99999)
      .toString()
      .padStart(5, '0');

    return `BATCH-${year}${month}${day}-${random}`;
  }
}
