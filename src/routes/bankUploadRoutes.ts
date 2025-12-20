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

/**
 * Get transaction comparison data for investigating variances
 * GET /api/bank-upload/comparison
 *
 * Compares bank transactions with fund transactions side-by-side
 * Groups bank transactions by goalNumber + transactionId to handle multiple
 * transactions with same transactionId (e.g., 2 withdrawals on same day)
 *
 * OPTIMIZED: Uses database-level aggregation to avoid heap overflow
 */
router.get('/comparison', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../config/database');

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const goalNumber = req.query.goalNumber as string;
    const accountNumber = req.query.accountNumber as string;
    const clientSearch = req.query.clientSearch as string;
    const matchStatus = req.query.matchStatus as string;

    const skip = (page - 1) * limit;

    // Build SQL WHERE conditions for bank transactions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      conditions.push(`b."transactionDate" >= $${paramIndex}`);
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`b."transactionDate" <= $${paramIndex}`);
      params.push(new Date(endDate));
      paramIndex++;
    }

    if (goalNumber) {
      conditions.push(`b."goalNumber" ILIKE $${paramIndex}`);
      params.push(`%${goalNumber}%`);
      paramIndex++;
    }

    if (accountNumber) {
      conditions.push(`a."accountNumber" ILIKE $${paramIndex}`);
      params.push(`%${accountNumber}%`);
      paramIndex++;
    }

    if (clientSearch) {
      const searchWords = clientSearch.trim().split(/\s+/);
      const wordConditions = searchWords.map((word) => {
        const cond = `(b."firstName" ILIKE $${paramIndex} OR b."lastName" ILIKE $${paramIndex})`;
        params.push(`%${word}%`);
        paramIndex++;
        return cond;
      });
      conditions.push(`(${wordConditions.join(' AND ')})`);
    }

    // Filter by reconciliation status at DB level for proper pagination
    // Cast to text for comparison since reconciliationStatus is an enum
    if (matchStatus && matchStatus !== 'ALL') {
      conditions.push(`b."reconciliationStatus"::text = $${paramIndex}`);
      params.push(matchStatus);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Step 1: Get aggregated bank transaction groups using raw SQL (paginated)
    // Note: Table names use snake_case as per Prisma @@map directives
    const aggregatedBankQuery = `
      SELECT
        b."goalNumber",
        b."transactionId",
        MIN(b."transactionDate") as "transactionDate",
        MIN(b."firstName") as "firstName",
        MIN(b."lastName") as "lastName",
        MIN(b."goalTitle") as "goalTitle",
        MIN(a."accountNumber") as "accountNumber",
        COUNT(*)::int as "txnCount",
        SUM(b."totalAmount")::float as "totalAmount",
        SUM(b."xummfAmount")::float as "xummfAmount",
        SUM(b."xubfAmount")::float as "xubfAmount",
        SUM(b."xudefAmount")::float as "xudefAmount",
        SUM(b."xurefAmount")::float as "xurefAmount",
        ARRAY_AGG(b."id") as "ids",
        MAX(CASE
          WHEN b."reconciliationStatus" = 'VARIANCE_DETECTED' THEN 2
          WHEN b."reconciliationStatus" = 'MANUAL_REVIEW' THEN 1
          ELSE 0
        END) as "statusPriority",
        MAX(b."reconciliationStatus") as "reconciliationStatus"
      FROM bank_goal_transactions b
      LEFT JOIN accounts a ON b."accountId" = a."id"
      ${whereClause}
      GROUP BY b."goalNumber", b."transactionId"
      ORDER BY MIN(b."transactionDate") DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, skip);

    // Step 2: Get total count of groups
    const countQuery = `
      SELECT COUNT(*) as total FROM (
        SELECT b."goalNumber", b."transactionId"
        FROM bank_goal_transactions b
        LEFT JOIN accounts a ON b."accountId" = a."id"
        ${whereClause}
        GROUP BY b."goalNumber", b."transactionId"
      ) as grouped
    `;

    const [bankGroups, countResult] = await Promise.all([
      prisma.$queryRawUnsafe(aggregatedBankQuery, ...params) as Promise<any[]>,
      prisma.$queryRawUnsafe(countQuery, ...params.slice(0, -2)) as Promise<any[]>,
    ]);

    const totalGroups = parseInt(countResult[0]?.total || '0');

    // Step 3: For each bank group, get matching fund transactions (only for current page)
    const comparisonData = await Promise.all(
      bankGroups.map(async (bankGroup: any) => {
        const matchKey = `${bankGroup.goalNumber}-${bankGroup.transactionId}`;

        // Find fund transactions by goalNumber + transactionId
        const fundTransactions = await prisma.fundTransaction.findMany({
          where: {
            goal: { goalNumber: bankGroup.goalNumber },
            transactionId: bankGroup.transactionId,
          },
          include: {
            fund: { select: { fundCode: true } },
            client: { select: { clientName: true } },
          },
        });

        // Aggregate fund amounts by fund code
        const fundAmounts: Record<string, number> = { XUMMF: 0, XUBF: 0, XUDEF: 0, XUREF: 0 };
        let fundTotalAmount = 0;
        let fundTransactionDate: Date | null = null;
        let fundClientName = '';
        let fundGoalTransactionCode = '';

        for (const ft of fundTransactions) {
          const amount = Number(ft.amount);
          fundAmounts[ft.fund.fundCode] = (fundAmounts[ft.fund.fundCode] || 0) + amount;
          fundTotalAmount += amount;
          if (!fundTransactionDate) fundTransactionDate = ft.transactionDate;
          if (!fundClientName) fundClientName = ft.client.clientName;
          if (!fundGoalTransactionCode) fundGoalTransactionCode = ft.goalTransactionCode;
        }

        // Calculate variances (aggregated bank vs aggregated fund)
        const bankTotalAmount = Number(bankGroup.totalAmount);
        const bankXummfAmount = Number(bankGroup.xummfAmount);
        const bankXubfAmount = Number(bankGroup.xubfAmount);
        const bankXudefAmount = Number(bankGroup.xudefAmount);
        const bankXurefAmount = Number(bankGroup.xurefAmount);

        const totalDiff = bankTotalAmount - fundTotalAmount;
        const xummfDiff = bankXummfAmount - fundAmounts.XUMMF;
        const xubfDiff = bankXubfAmount - fundAmounts.XUBF;
        const xudefDiff = bankXudefAmount - fundAmounts.XUDEF;
        const xurefDiff = bankXurefAmount - fundAmounts.XUREF;

        // Determine match status
        let calculatedMatchStatus: string;
        if (fundTransactions.length === 0) {
          calculatedMatchStatus = 'MISSING_IN_FUND';
        } else if (Math.abs(totalDiff) <= Math.max(fundTotalAmount * 0.01, 1000)) {
          calculatedMatchStatus = 'MATCHED';
        } else {
          calculatedMatchStatus = 'VARIANCE_DETECTED';
        }

        return {
          matchKey,
          matchStatus: calculatedMatchStatus,
          bankTransactionCount: bankGroup.txnCount,
          bank: {
            ids: bankGroup.ids,
            transactionDate: bankGroup.transactionDate,
            clientName: `${bankGroup.firstName} ${bankGroup.lastName}`,
            accountNumber: bankGroup.accountNumber || '',
            goalNumber: bankGroup.goalNumber,
            goalTitle: bankGroup.goalTitle,
            transactionId: bankGroup.transactionId,
            totalAmount: bankTotalAmount,
            xummfAmount: bankXummfAmount,
            xubfAmount: bankXubfAmount,
            xudefAmount: bankXudefAmount,
            xurefAmount: bankXurefAmount,
            reconciliationStatus: bankGroup.reconciliationStatus,
          },
          fund: fundTransactions.length > 0 ? {
            goalTransactionCode: fundGoalTransactionCode,
            transactionDate: fundTransactionDate,
            clientName: fundClientName,
            totalAmount: fundTotalAmount,
            xummfAmount: fundAmounts.XUMMF,
            xubfAmount: fundAmounts.XUBF,
            xudefAmount: fundAmounts.XUDEF,
            xurefAmount: fundAmounts.XUREF,
            fundCount: fundTransactions.length,
          } : null,
          variance: {
            totalDiff,
            xummfDiff,
            xubfDiff,
            xudefDiff,
            xurefDiff,
            hasVariance: Math.abs(totalDiff) > Math.max(fundTotalAmount * 0.01, 1000),
          },
        };
      })
    );

    // Note: matchStatus filtering is now done at DB level for proper pagination
    const filteredData = comparisonData;

    // Calculate aggregates from current page data
    let bankTotal = 0;
    let fundTotal = 0;
    let matchedCount = 0;
    let varianceCount = 0;
    let missingInFundCount = 0;

    for (const row of filteredData) {
      bankTotal += row.bank.totalAmount;
      fundTotal += row.fund?.totalAmount || 0;
      if (row.matchStatus === 'MATCHED') matchedCount++;
      else if (row.matchStatus === 'VARIANCE_DETECTED') varianceCount++;
      else if (row.matchStatus === 'MISSING_IN_FUND') missingInFundCount++;
    }

    const varianceAmount = Math.abs(bankTotal - fundTotal);
    const matchRate = filteredData.length > 0 ? (matchedCount / filteredData.length) * 100 : 0;

    res.json({
      success: true,
      data: filteredData,
      aggregates: {
        bankTotal,
        fundTotal,
        varianceAmount,
        matchedCount,
        varianceCount,
        missingInFundCount,
        matchRate: Math.round(matchRate * 100) / 100,
      },
      pagination: {
        page,
        limit,
        total: totalGroups,
        totalPages: Math.ceil(totalGroups / limit),
      },
    });
  } catch (error) {
    logger.error('Error fetching comparison data:', error);
    next(error);
  }
});

/**
 * Export comparison data as CSV
 * GET /api/bank-upload/comparison/export
 *
 * Groups bank transactions by goalNumber + transactionId to handle multiple
 * transactions with same transactionId (e.g., 2 withdrawals on same day)
 *
 * OPTIMIZED: Uses database-level aggregation and batched processing to avoid heap overflow
 */
router.get('/comparison/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../config/database');

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const goalNumber = req.query.goalNumber as string;
    const accountNumber = req.query.accountNumber as string;
    const clientSearch = req.query.clientSearch as string;
    const matchStatus = req.query.matchStatus as string;

    // Build SQL WHERE conditions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      conditions.push(`b."transactionDate" >= $${paramIndex}`);
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      conditions.push(`b."transactionDate" <= $${paramIndex}`);
      params.push(new Date(endDate));
      paramIndex++;
    }

    if (goalNumber) {
      conditions.push(`b."goalNumber" ILIKE $${paramIndex}`);
      params.push(`%${goalNumber}%`);
      paramIndex++;
    }

    if (accountNumber) {
      conditions.push(`a."accountNumber" ILIKE $${paramIndex}`);
      params.push(`%${accountNumber}%`);
      paramIndex++;
    }

    if (clientSearch) {
      const searchWords = clientSearch.trim().split(/\s+/);
      const wordConditions = searchWords.map((word) => {
        const cond = `(b."firstName" ILIKE $${paramIndex} OR b."lastName" ILIKE $${paramIndex})`;
        params.push(`%${word}%`);
        paramIndex++;
        return cond;
      });
      conditions.push(`(${wordConditions.join(' AND ')})`);
    }

    // Filter by reconciliation status at DB level
    // Cast to text for comparison since reconciliationStatus is an enum
    if (matchStatus && matchStatus !== 'ALL') {
      conditions.push(`b."reconciliationStatus"::text = $${paramIndex}`);
      params.push(matchStatus);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get aggregated bank transaction groups using raw SQL
    // Note: Table names use snake_case as per Prisma @@map directives
    const aggregatedBankQuery = `
      SELECT
        b."goalNumber",
        b."transactionId",
        MIN(b."transactionDate") as "transactionDate",
        MIN(b."firstName") as "firstName",
        MIN(b."lastName") as "lastName",
        MIN(a."accountNumber") as "accountNumber",
        COUNT(*)::int as "txnCount",
        SUM(b."totalAmount")::float as "totalAmount",
        SUM(b."xummfAmount")::float as "xummfAmount",
        SUM(b."xubfAmount")::float as "xubfAmount",
        SUM(b."xudefAmount")::float as "xudefAmount",
        SUM(b."xurefAmount")::float as "xurefAmount"
      FROM bank_goal_transactions b
      LEFT JOIN accounts a ON b."accountId" = a."id"
      ${whereClause}
      GROUP BY b."goalNumber", b."transactionId"
      ORDER BY MIN(b."transactionDate") DESC
    `;

    const bankGroups = await prisma.$queryRawUnsafe(aggregatedBankQuery, ...params) as any[];

    // Build CSV headers
    const headers = [
      'Goal Number',
      'Transaction ID',
      'Date',
      'Client Name',
      'Account',
      'Bank Txn Count',
      'Match Status',
      'Bank Total',
      'Fund Total',
      'Variance',
      'Bank XUMMF',
      'Fund XUMMF',
      'XUMMF Diff',
      'Bank XUBF',
      'Fund XUBF',
      'XUBF Diff',
      'Bank XUDEF',
      'Fund XUDEF',
      'XUDEF Diff',
      'Bank XUREF',
      'Fund XUREF',
      'XUREF Diff',
    ].join(',');

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 100;
    const rows: string[] = [];

    for (let i = 0; i < bankGroups.length; i += BATCH_SIZE) {
      const batch = bankGroups.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (bankGroup: any) => {
          // Find fund transactions
          const fundTransactions = await prisma.fundTransaction.findMany({
            where: {
              goal: { goalNumber: bankGroup.goalNumber },
              transactionId: bankGroup.transactionId,
            },
            include: { fund: { select: { fundCode: true } } },
          });

          const fundAmounts: Record<string, number> = { XUMMF: 0, XUBF: 0, XUDEF: 0, XUREF: 0 };
          let fundTotalAmount = 0;
          for (const ft of fundTransactions) {
            fundAmounts[ft.fund.fundCode] = (fundAmounts[ft.fund.fundCode] || 0) + Number(ft.amount);
            fundTotalAmount += Number(ft.amount);
          }

          const bankTotalAmount = Number(bankGroup.totalAmount);
          const bankXummfAmount = Number(bankGroup.xummfAmount);
          const bankXubfAmount = Number(bankGroup.xubfAmount);
          const bankXudefAmount = Number(bankGroup.xudefAmount);
          const bankXurefAmount = Number(bankGroup.xurefAmount);

          const totalDiff = bankTotalAmount - fundTotalAmount;
          const matchStatusValue = fundTransactions.length === 0 ? 'MISSING_IN_FUND' :
            Math.abs(totalDiff) <= Math.max(fundTotalAmount * 0.01, 1000) ? 'MATCHED' : 'VARIANCE_DETECTED';

          // Note: matchStatus filtering is now done at DB level
          return [
            bankGroup.goalNumber,
            bankGroup.transactionId,
            new Date(bankGroup.transactionDate).toISOString().split('T')[0],
            `"${bankGroup.firstName} ${bankGroup.lastName}"`,
            bankGroup.accountNumber || '',
            bankGroup.txnCount,
            matchStatusValue,
            bankTotalAmount,
            fundTotalAmount,
            totalDiff,
            bankXummfAmount,
            fundAmounts.XUMMF,
            bankXummfAmount - fundAmounts.XUMMF,
            bankXubfAmount,
            fundAmounts.XUBF,
            bankXubfAmount - fundAmounts.XUBF,
            bankXudefAmount,
            fundAmounts.XUDEF,
            bankXudefAmount - fundAmounts.XUDEF,
            bankXurefAmount,
            fundAmounts.XUREF,
            bankXurefAmount - fundAmounts.XUREF,
          ].join(',');
        })
      );

      // Add results to rows
      rows.push(...batchResults);
    }

    const csvContent = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transaction_comparison_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error) {
    logger.error('Error exporting comparison data:', error);
    next(error);
  }
});

export default router;
