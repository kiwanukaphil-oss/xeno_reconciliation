import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { Prisma } from '@prisma/client';

/**
 * Manages bank upload batch database operations
 * Mirrors UploadBatchManager for consistency
 */
export class BankUploadBatchManager {
  /**
   * Creates a new bank upload batch
   */
  static async createUploadBatch(data: {
    fileName: string;
    fileSize: number;
    filePath: string;
    uploadedBy: string;
    metadata?: any;
  }): Promise<string> {
    const batchNumber = this.generateBatchNumber();

    const batch = await prisma.bankUploadBatch.create({
      data: {
        batchNumber,
        fileName: data.fileName,
        fileSize: BigInt(data.fileSize),
        filePath: data.filePath,
        processingStatus: 'QUEUED',
        validationStatus: 'PENDING',
        uploadedBy: data.uploadedBy,
        uploadedAt: new Date(),
        metadata: data.metadata || {},
      },
    });

    logger.info(`Bank upload batch created: ${batchNumber} (${batch.id})`);

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

    await prisma.bankUploadBatch.update({
      where: { id: batchId },
      data: updateData,
    });

    logger.info(`Bank batch ${batchId} status updated: ${processingStatus}`);
  }

  /**
   * Updates batch with parsing results
   */
  static async updateBatchWithParsingResults(
    batchId: string,
    totalRecords: number
  ): Promise<void> {
    await prisma.bankUploadBatch.update({
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
      transactionsWithWarnings?: number;
    }
  ): Promise<void> {
    // Get existing metadata to merge
    const existingBatch = await prisma.bankUploadBatch.findUnique({
      where: { id: batchId },
      select: { metadata: true },
    });

    const metadata = {
      ...(existingBatch?.metadata as object || {}),
      transactionsWithWarnings: data.transactionsWithWarnings || 0,
    };

    await prisma.bankUploadBatch.update({
      where: { id: batchId },
      data: {
        processedRecords: data.processedRecords,
        failedRecords: data.failedRecords,
        validationErrors: data.validationErrors,
        validationWarnings: data.validationWarnings,
        validationStatus: data.validationStatus as any,
        processingStatus: 'PROCESSING',
        metadata,
      },
    });
  }

  /**
   * Updates batch with final processing results
   */
  static async updateBatchWithFinalResults(
    batchId: string,
    data: {
      totalAmount: number;
      processedRecords: number;
      metadata?: any;
    }
  ): Promise<void> {
    await prisma.bankUploadBatch.update({
      where: { id: batchId },
      data: {
        totalAmount: new Prisma.Decimal(data.totalAmount),
        processedRecords: data.processedRecords,
        metadata: data.metadata,
        processingStatus: 'COMPLETED',
        validationStatus: 'PASSED',
        processingCompletedAt: new Date(),
      },
    });

    logger.info(`Bank batch ${batchId} processing completed`);
  }

  /**
   * Updates batch with error
   */
  static async updateBatchWithError(
    batchId: string,
    error: Error,
    validationErrors?: any
  ): Promise<void> {
    await prisma.bankUploadBatch.update({
      where: { id: batchId },
      data: {
        processingStatus: 'FAILED',
        validationStatus: 'FAILED',
        validationErrors: validationErrors || { error: error.message },
        processingCompletedAt: new Date(),
      },
    });

    logger.error(`Bank batch ${batchId} failed:`, error);
  }

  /**
   * Gets batch details
   */
  static async getBatch(batchId: string) {
    return await prisma.bankUploadBatch.findUnique({
      where: { id: batchId },
    });
  }

  /**
   * Gets batch summary (converts BigInt to number for JSON serialization)
   */
  static async getBatchSummary(batchId: string) {
    const batch = await prisma.bankUploadBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      return null;
    }

    return {
      ...batch,
      fileSize: Number(batch.fileSize),
      totalAmount: batch.totalAmount.toNumber(),
      varianceAmount: batch.varianceAmount.toNumber(),
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
      prisma.bankUploadBatch.findMany({
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
          totalMatched: true,
          totalUnmatched: true,
          totalVariances: true,
          autoApprovedCount: true,
          manualReviewCount: true,
          totalAmount: true,
          varianceAmount: true,
          uploadedAt: true,
          processingStartedAt: true,
          processingCompletedAt: true,
          uploadedBy: true,
          metadata: true,
        },
      }),
      prisma.bankUploadBatch.count(),
    ]);

    // Convert BigInt and Decimal fields to numbers for JSON serialization
    const formattedBatches = batches.map((batch) => ({
      ...batch,
      fileSize: Number(batch.fileSize),
      totalAmount: batch.totalAmount.toNumber(),
      varianceAmount: batch.varianceAmount.toNumber(),
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
    await prisma.bankUploadBatch.update({
      where: { id: batchId },
      data: {
        processingStatus: 'CANCELED',
        processingCompletedAt: new Date(),
      },
    });

    logger.info(`Bank batch ${batchId} canceled`);
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

    return `BANK-${year}${month}${day}-${random}`;
  }
}
