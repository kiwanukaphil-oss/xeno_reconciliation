import express, { Request, Response, NextFunction } from 'express';
import { upload, handleUploadErrors } from '../middleware/upload';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { bankReconciliationQueue, JobNames } from '../config/queue';
import { BankUploadBatchManager } from '../services/bank-upload/database/BankUploadBatchManager';
import { BankTransactionRepository } from '../services/bank-upload/database/BankTransactionRepository';
import { BankFileProcessor } from '../services/bank-upload/BankFileProcessor';

const router = express.Router();

/**
 * Download CSV template for bank transactions
 * GET /api/bank-upload/template
 */
router.get('/template', (_req: Request, res: Response) => {
  const templateHeader = [
    'Date',
    'First Name',
    'Last Name',
    'Acc Number',
    'Goal Name',
    'Goal Number',
    'Total Amount',
    'XUMMF %',
    'XUBF %',
    'XUDEF %',
    'XUREF %',
    'XUMMF Amount',
    'XUBF Amount',
    'XUDEF Amount',
    'XUREF Amount',
    'Transaction Type',
    'Transaction ID',
  ].join(',');

  const sampleRow = [
    '2025-01-15',
    'John',
    'Doe',
    '701-1234567890',
    'Retirement Fund',
    '701-1234567890a',
    '1000000',
    '25',
    '25',
    '25',
    '25',
    '250000',
    '250000',
    '250000',
    '250000',
    'DEPOSIT',
    'TXN123456789',
  ].join(',');

  const csvContent = `${templateHeader}\n${sampleRow}`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bank_transactions_template.csv"');
  res.send(csvContent);
});

/**
 * Upload a bank transaction file
 * POST /api/bank-upload/upload
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

      const uploadedBy = req.body.uploadedBy || 'system';
      const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

      logger.info(`Bank file upload received: ${req.file.originalname}`);

      // Validate file before processing
      const validation = await BankFileProcessor.validateFile(req.file.path);
      if (!validation.isValid) {
        throw new AppError(400, `File validation failed: ${validation.errors.join(', ')}`);
      }

      // Create upload batch
      const batchId = await BankUploadBatchManager.createUploadBatch({
        fileName: req.file.originalname,
        fileSize: req.file.size,
        filePath: req.file.path,
        uploadedBy,
        metadata,
      });

      // Enqueue processing job
      await bankReconciliationQueue.add(
        JobNames.PROCESS_BANK_UPLOAD,
        {
          batchId,
          filePath: req.file.path,
        },
        {
          jobId: batchId,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      logger.info(`Bank upload batch queued: ${batchId}`);

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
 * GET /api/bank-upload/batches/:batchId/status
 */
router.get('/batches/:batchId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await BankUploadBatchManager.getBatchSummary(batchId);
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
 * GET /api/bank-upload/batches/:batchId/summary
 */
router.get('/batches/:batchId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await BankUploadBatchManager.getBatchSummary(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    res.json(batch);
  } catch (error) {
    next(error);
  }
});

/**
 * Cancel an upload batch
 * POST /api/bank-upload/batches/:batchId/cancel
 */
router.post('/batches/:batchId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await BankUploadBatchManager.getBatch(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    // Cancel the batch
    await BankUploadBatchManager.cancelBatch(batchId);

    // Remove job from queue if exists
    const job = await bankReconciliationQueue.getJob(batchId);
    if (job) {
      await job.remove();
    }

    // Delete transactions if any
    await BankTransactionRepository.deleteTransactionsByBatchId(batchId);

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
 * DELETE /api/bank-upload/batches/:batchId/rollback
 */
router.delete('/batches/:batchId/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const batch = await BankUploadBatchManager.getBatch(batchId);
    if (!batch) {
      throw new AppError(404, 'Batch not found');
    }

    // Remove job from queue if exists
    const job = await bankReconciliationQueue.getJob(batchId);
    if (job) {
      await job.remove();
    }

    // Delete transactions
    const deletedTransactions = await BankTransactionRepository.deleteTransactionsByBatchId(batchId);

    // Delete the batch
    const { prisma } = await import('../config/database');
    await prisma.bankUploadBatch.delete({
      where: { id: batchId },
    });

    res.json({
      success: true,
      message: 'Batch deleted successfully',
      deletedCounts: {
        bankTransactions: deletedTransactions,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all batches (with pagination)
 * GET /api/bank-upload/batches
 */
router.get('/batches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await BankUploadBatchManager.getAllBatches({ page, limit });

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
 * GET /api/bank-upload/batches/:batchId/transactions
 */
router.get('/batches/:batchId/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batchId } = req.params;

    const transactions = await BankTransactionRepository.getTransactionsByBatchId(batchId);

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
 * Get all bank transactions with filters and pagination
 * GET /api/bank-upload/transactions
 */
router.get('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const transactionType = req.query.transactionType as string;
    const reconciliationStatus = req.query.reconciliationStatus as string;

    const result = await BankTransactionRepository.getAllTransactions({
      page,
      limit,
      startDate,
      endDate,
      search,
      transactionType,
      reconciliationStatus,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Get single transaction by ID
 * GET /api/bank-upload/transactions/:transactionId
 */
router.get('/transactions/:transactionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.params;

    const transaction = await BankTransactionRepository.getTransactionById(transactionId);
    if (!transaction) {
      throw new AppError(404, 'Transaction not found');
    }

    res.json(transaction);
  } catch (error) {
    next(error);
  }
});

/**
 * Update reconciliation status for a single transaction
 * PATCH /api/bank-upload/transactions/:transactionId/status
 */
router.patch('/transactions/:transactionId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.params;
    const { status, notes, updatedBy } = req.body;

    if (!status) {
      throw new AppError(400, 'Status is required');
    }

    // Validate status value
    const validStatuses = [
      'PENDING',
      'MATCHED',
      'VARIANCE_DETECTED',
      'AUTO_APPROVED',
      'MANUAL_REVIEW',
      'APPROVED',
      'REJECTED',
      'MISSING_IN_FUND',
    ];

    if (!validStatuses.includes(status)) {
      throw new AppError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const result = await BankTransactionRepository.updateTransactionStatus(
      transactionId,
      status,
      notes,
      updatedBy || 'system'
    );

    res.json({
      success: true,
      message: 'Transaction status updated',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Bulk update reconciliation status for multiple transactions
 * POST /api/bank-upload/transactions/bulk-status
 */
router.post('/transactions/bulk-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionIds, status, notes, updatedBy } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      throw new AppError(400, 'transactionIds array is required');
    }

    if (!status) {
      throw new AppError(400, 'Status is required');
    }

    // Validate status value
    const validStatuses = [
      'PENDING',
      'MATCHED',
      'VARIANCE_DETECTED',
      'AUTO_APPROVED',
      'MANUAL_REVIEW',
      'APPROVED',
      'REJECTED',
      'MISSING_IN_FUND',
    ];

    if (!validStatuses.includes(status)) {
      throw new AppError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const result = await BankTransactionRepository.bulkUpdateTransactionStatus(
      transactionIds,
      status,
      notes,
      updatedBy || 'system'
    );

    res.json({
      success: true,
      message: `Updated ${result.updated} transactions`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Export bank transactions as CSV
 * GET /api/bank-upload/transactions/export
 */
router.get('/transactions/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const transactionType = req.query.transactionType as string;
    const reconciliationStatus = req.query.reconciliationStatus as string;

    // Get all matching transactions (no pagination for export)
    const result = await BankTransactionRepository.getAllTransactions({
      page: 1,
      limit: 100000, // Large limit for export
      startDate,
      endDate,
      search,
      transactionType,
      reconciliationStatus,
    });

    // Build CSV content
    const headers = [
      'Date',
      'Transaction ID',
      'Type',
      'Client Name',
      'Account Number',
      'Goal Number',
      'Goal Title',
      'Total Amount',
      'XUMMF %',
      'XUBF %',
      'XUDEF %',
      'XUREF %',
      'XUMMF Amount',
      'XUBF Amount',
      'XUDEF Amount',
      'XUREF Amount',
      'Reconciliation Status',
    ].join(',');

    const rows = result.data.map((txn) => [
      new Date(txn.transactionDate).toISOString().split('T')[0],
      txn.transactionId,
      txn.transactionType,
      `"${txn.clientName}"`,
      txn.accountNumber,
      txn.goalNumber,
      `"${txn.goalTitle}"`,
      txn.totalAmount,
      txn.xummfPercentage.toFixed(2),
      txn.xubfPercentage.toFixed(2),
      txn.xudefPercentage.toFixed(2),
      txn.xurefPercentage.toFixed(2),
      txn.xummfAmount,
      txn.xubfAmount,
      txn.xudefAmount,
      txn.xurefAmount,
      txn.reconciliationStatus,
    ].join(','));

    const csvContent = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bank_transactions_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error) {
    next(error);
  }
});

/**
 * Run reconciliation on pending bank transactions
 * POST /api/bank-upload/reconciliation/run
 */
router.post('/reconciliation/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionIds, batchSize } = req.body;

    // Validate batch size (min 100, max 50000)
    const validatedBatchSize = Math.min(50000, Math.max(100, parseInt(batchSize) || 2000));

    logger.info('Starting reconciliation process', {
      transactionIds: transactionIds?.length || 'all pending',
      batchSize: validatedBatchSize,
    });

    const result = await BankTransactionRepository.runReconciliation(transactionIds, validatedBatchSize);

    logger.info('Reconciliation completed', result);

    res.json({
      success: true,
      message: 'Reconciliation completed',
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get reconciliation statistics
 * GET /api/bank-upload/reconciliation/stats
 */
router.get('/reconciliation/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await BankTransactionRepository.getReconciliationStats();

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

export default router;
