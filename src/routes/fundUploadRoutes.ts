import express, { Request, Response, NextFunction } from 'express';
import { upload, handleUploadErrors } from '../middleware/upload';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { fundProcessingQueue, JobNames } from '../config/queue';
import { UploadBatchManager } from '../services/fund-upload/database/UploadBatchManager';
import { FundTransactionRepository } from '../services/fund-upload/database/FundTransactionRepository';
import { FundFileProcessor } from '../services/fund-upload/FundFileProcessor';
import { BatchRollbackService } from '../services/fund-upload/database/BatchRollbackService';

const router = express.Router();

/**
 * Download CSV template for fund transactions
 * GET /api/fund-upload/template
 */
router.get('/template', (_req: Request, res: Response) => {
  const templateHeader = [
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
    'sponsorCode',
  ].join(',');

  const sampleRow = [
    '550e8400-e29b-41d4-a716-446655440000',
    '2025-11-19',
    'Sample Client',
    'XUMMF',
    '100000',
    '1000.00',
    'DEPOSIT',
    '99.80',
    '100.00',
    '99.90',
    '2025-11-19',
    'Sample Goal',
    '701-5558635193a',
    '701-555863519',
    'PERSONAL',
    'GENERAL',
    '',
  ].join(',');

  const csvContent = `${templateHeader}\n${sampleRow}`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="fund_transactions_template.csv"');
  res.send(csvContent);
});

/**
 * Upload a fund transaction file
 * POST /api/fund-upload/upload
 */
router.post(
  '/upload',
  upload.single('file'),
  handleUploadErrors,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError(400, 'No file uploaded');
      }

      const uploadedBy = req.body.uploadedBy || 'system'; // TODO: Get from auth

      logger.info(`File upload received: ${req.file.originalname}`);

      // Validate file before processing
      const validation = await FundFileProcessor.validateFile(req.file.path);
      if (!validation.isValid) {
        throw new AppError(400, `File validation failed: ${validation.errors.join(', ')}`);
      }

      // Create upload batch
      const batchId = await UploadBatchManager.createUploadBatch({
        fileName: req.file.originalname,
        fileSize: req.file.size,
        filePath: req.file.path,
        uploadedBy,
      });

      // Enqueue processing job
      await fundProcessingQueue.add(
        JobNames.PROCESS_NEW_UPLOAD,
        {
          batchId,
          filePath: req.file.path,
        },
        {
          jobId: batchId, // Use batchId as jobId for easy tracking
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      logger.info(`Upload batch queued: ${batchId}`);

      res.status(202).json({
        message: 'File uploaded and queued for processing',
        batchId,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        rowCount: validation.rowCount,
        status: 'queued',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get upload batch status
 * GET /api/fund-upload/batches/:batchId/status
 */
router.get('/batches/:batchId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await UploadBatchManager.getBatchSummary(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    res.json({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      fileName: batch.fileName,
      processingStatus: batch.processingStatus,
      validationStatus: batch.validationStatus,
      totalRecords: batch.totalRecords,
      processedRecords: batch.processedRecords,
      failedRecords: batch.failedRecords,
      uploadedAt: batch.uploadedAt,
      processingStartedAt: batch.processingStartedAt,
      processingCompletedAt: batch.processingCompletedAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get full upload batch summary
 * GET /api/fund-upload/batches/:batchId/summary
 */
router.get('/batches/:batchId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await UploadBatchManager.getBatchSummary(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    res.json(batch);
  } catch (error) {
    next(error);
  }
});

/**
 * Get new entities detected in upload
 * GET /api/fund-upload/batches/:batchId/new-entities
 */
router.get('/batches/:batchId/new-entities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await UploadBatchManager.getBatch(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    if (batch.processingStatus !== 'WAITING_FOR_APPROVAL') {
      throw new AppError(400, 'Batch is not waiting for approval');
    }

    res.json({
      batchId: batch.id,
      newEntitiesStatus: batch.newEntitiesStatus,
      newEntitiesReport: batch.newEntitiesReport,
      summary: {
        clients: batch.newClientsDetected,
        accounts: batch.newAccountsDetected,
        goals: batch.newGoalsDetected,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Approve new entities and resume processing
 * POST /api/fund-upload/batches/:batchId/approve-entities
 */
router.post(
  '/batches/:batchId/approve-entities',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { batchId } = req.params;
      const { approvalStatus } = req.body; // 'approved' or 'rejected'
      const approvedBy = req.body.approvedBy || 'system'; // TODO: Get from auth

      if (!['approved', 'rejected'].includes(approvalStatus)) {
        throw new AppError(400, 'Invalid approval status. Must be "approved" or "rejected"');
      }

      const batch = await UploadBatchManager.getBatch(batchId);
      if (!batch) {
        throw new AppError(404, 'Batch not found');
      }

      if (batch.processingStatus !== 'WAITING_FOR_APPROVAL') {
        throw new AppError(400, 'Batch is not waiting for approval');
      }

      // Update batch with approval status (validated above as 'approved' or 'rejected')
      await UploadBatchManager.updateBatchAfterApproval(
        batchId,
        approvalStatus.toUpperCase() as 'APPROVED' | 'REJECTED',
        approvedBy
      );

      if (approvalStatus === 'approved') {
        // Enqueue resume job
        await fundProcessingQueue.add(
          JobNames.RESUME_AFTER_APPROVAL,
          {
            batchId,
            filePath: batch.filePath,
          },
          {
            jobId: `${batchId}-resume`,
          }
        );

        res.json({
          message: 'Entities approved. Processing resumed.',
          batchId,
          status: 'processing',
        });
      } else {
        res.json({
          message: 'Entities rejected. Batch failed.',
          batchId,
          status: 'failed',
        });
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Cancel an upload batch
 * POST /api/fund-upload/batches/:batchId/cancel
 */
router.post('/batches/:batchId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await UploadBatchManager.getBatch(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    // Cancel the batch
    await UploadBatchManager.cancelBatch(batchId);

    // Remove job from queue if exists
    const job = await fundProcessingQueue.getJob(batchId);
    if (job) {
      await job.remove();
    }

    // Delete transactions if any
    await FundTransactionRepository.deleteTransactionsByBatchId(batchId);

    res.json({
      message: 'Batch canceled successfully',
      batchId,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Rollback an upload batch - delete batch and all associated data
 * DELETE /api/fund-upload/batches/:batchId/rollback
 */
router.delete('/batches/:batchId/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    // Check if batch exists and can be rolled back
    const eligibility = await BatchRollbackService.canRollback(batchId);
    if (!eligibility.canRollback) {
      throw new AppError(400, eligibility.reason || 'Cannot rollback this batch');
    }

    // Remove job from queue if exists
    const job = await fundProcessingQueue.getJob(batchId);
    if (job) {
      await job.remove();
    }

    // Also try to remove resume job if exists
    const resumeJob = await fundProcessingQueue.getJob(`${batchId}-resume`);
    if (resumeJob) {
      await resumeJob.remove();
    }

    // Perform rollback
    const result = await BatchRollbackService.rollbackBatch(batchId);

    res.json({
      success: true,
      message: result.message,
      deletedCounts: result.deletedCounts,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all batches (with pagination)
 * GET /api/fund-upload/batches
 */
router.get('/batches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await UploadBatchManager.getAllBatches({ page, limit });

    res.json({
      data: result.batches,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.pages,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get transactions for a batch
 * GET /api/fund-upload/batches/:batchId/transactions
 */
router.get('/batches/:batchId/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const transactions = await FundTransactionRepository.getTransactionsByBatchId(batchId);

    res.json({
      batchId,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get invalid transactions for a batch
 * GET /api/fund-upload/batches/:batchId/invalid-transactions
 */
router.get(
  '/batches/:batchId/invalid-transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { batchId } = req.params;

      const invalidTransactions =
        await FundTransactionRepository.getInvalidTransactionsByBatchId(batchId);

      res.json({
        batchId,
        count: invalidTransactions.length,
        invalidTransactions,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
