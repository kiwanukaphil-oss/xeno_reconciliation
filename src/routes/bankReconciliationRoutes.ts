import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { BankReconciliationService } from '../services/reconciliation/BankReconciliationService';
import { logger } from '../config/logger';

const router = Router();
const reconciliationService = new BankReconciliationService();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads/temp';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `bank-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024),
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
      cb(new Error('Only CSV files are allowed'));
      return;
    }
    cb(null, true);
  },
});

/**
 * GET /api/bank-reconciliation/template/download
 * Download bank transaction CSV template
 */
router.get('/template/download', (_req: Request, res: Response): void => {
  try {
    // CSV headers matching the expected format
    const headers = [
      'Date',
      'First Name',
      'Last Name',
      'Acc Number',
      'Goal Name',
      'Goal Number',
      'Total Amount',
      'XUMMF',  // Percentage
      'XUBF',   // Percentage
      'XUDEF',  // Percentage
      'XUREF',  // Percentage
      'XUMMF',  // Amount
      'XUBF',   // Amount
      'XUDEF',  // Amount
      'XUREF',  // Amount
      'Transaction Type',
      'Transaction ID',
    ];

    // Sample data rows to guide users
    const sampleRows = [
      [
        '2025-01-15',           // Date (YYYY-MM-DD format)
        'John',                 // First Name
        'Doe',                  // Last Name
        '701-1234567890',       // Acc Number
        'Retirement Fund',      // Goal Name
        '701-1234567890a',      // Goal Number
        '1000000',              // Total Amount (UGX)
        '25',                   // XUMMF % (percentage)
        '25',                   // XUBF %
        '25',                   // XUDEF %
        '25',                   // XUREF %
        '250000',               // XUMMF $ (amount)
        '250000',               // XUBF $
        '250000',               // XUDEF $
        '250000',               // XUREF $
        'DEPOSIT',              // Transaction Type (DEPOSIT/WITHDRAWAL/REDEMPTION/TRANSFER)
        'TXN123456789',         // Transaction ID (from bank statement)
      ],
      [
        '2025-01-16',
        'Jane',
        'Smith',
        '701-9876543210',
        'Education Savings',
        '701-9876543210b',
        '500000',
        '30',
        '30',
        '20',
        '20',
        '150000',
        '150000',
        '100000',
        '100000',
        'DEPOSIT',
        'TXN987654321',
      ],
    ];

    // Build CSV content
    const csvContent = [
      headers.join(','),
      ...sampleRows.map(row => row.join(',')),
    ].join('\n');

    // Add instructions as comments at the top
    const instructions = `# Bank Transaction Upload Template
# ================================
# Instructions:
# 1. Date: Use YYYY-MM-DD format (e.g., 2025-01-15)
# 2. First Name / Last Name: Client's name as registered
# 3. Acc Number: Account number in format XXX-XXXXXXXXXX
# 4. Goal Name: Name of the investment goal
# 5. Goal Number: Goal number (account number + letter suffix)
# 6. Total Amount: Total transaction amount in UGX
# 7. Fund Percentages (XUMMF%, XUBF%, XUDEF%, XUREF%): Must total 100%
# 8. Fund Amounts: Individual amounts per fund (must total to Total Amount)
# 9. Transaction Type: DEPOSIT, WITHDRAWAL, REDEMPTION, or TRANSFER
# 10. Transaction ID: Unique ID from bank statement
#
# Note: The fund columns appear twice - first for percentages, then for amounts
# Delete these instruction lines before uploading
#
`;

    const fullCsvContent = instructions + csvContent;

    // Set response headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bank_transactions_template.csv"');
    res.send(fullCsvContent);

    logger.info('Bank transaction template downloaded');
  } catch (error: any) {
    logger.error('Error generating bank template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate template',
      message: error.message,
    });
  }
});

/**
 * POST /api/bank-reconciliation/upload
 * Upload bank transaction CSV file for reconciliation
 * Returns immediately with batch ID - processing happens in background
 */
router.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
        return;
      }

      const { uploadedBy, metadata } = req.body;

      if (!uploadedBy) {
        // Clean up uploaded file
        await fs.unlink(req.file.path);
        res.status(400).json({
          success: false,
          error: 'uploadedBy is required',
        });
        return;
      }

      logger.info(`Bank transaction upload queued: ${req.file.originalname}`);

      // Parse metadata if provided as JSON string
      let parsedMetadata;
      if (metadata) {
        try {
          parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        } catch (error) {
          logger.warn('Invalid metadata JSON, using as-is');
          parsedMetadata = { raw: metadata };
        }
      }

      // Upload and save bank transactions (no queue, direct processing)
      const result = await reconciliationService.uploadBankTransactions(
        req.file.path,
        req.file.originalname,
        uploadedBy,
        parsedMetadata
      );

      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (error: any) {
      logger.error('Error queueing bank upload:', error);

      // Clean up file if it exists
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          logger.error('Error cleaning up file:', unlinkError);
        }
      }

      res.status(500).json({
        success: false,
        error: 'Failed to queue bank upload',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/bank-reconciliation/batches/:batchId/status
 * Get processing status for a batch (for polling)
 */
router.get(
  '/batches/:batchId/status',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const status = await reconciliationService.getBatchStatus(batchId);

      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      logger.error('Error getting batch status:', error);
      res.status(404).json({
        success: false,
        error: 'Failed to get batch status',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/bank-reconciliation/batches/:batchId/summary
 * Get reconciliation summary for a batch
 */
router.get('/batches/:batchId/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;

    const summary = await reconciliationService.getBatchSummary(batchId);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    logger.error('Error fetching batch summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch batch summary',
      message: error.message,
    });
  }
});

/**
 * GET /api/bank-reconciliation/batches/:batchId/report
 * Get detailed reconciliation report
 */
router.get('/batches/:batchId/report', async (req: Request, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;

    const report = await reconciliationService.getReconciliationReport(batchId);

    res.json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    logger.error('Error generating reconciliation report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate reconciliation report',
      message: error.message,
    });
  }
});

/**
 * GET /api/bank-reconciliation/batches
 * List all bank upload batches
 */
router.get('/batches', async (req: Request, res: Response): Promise<void> => {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const [batches, total] = await Promise.all([
      prisma.bankUploadBatch.findMany({
        take: limit,
        skip: offset,
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          batchNumber: true,
          fileName: true,
          processingStatus: true,
          totalRecords: true,
          processedRecords: true,
          totalMatched: true,
          totalUnmatched: true,
          autoApprovedCount: true,
          manualReviewCount: true,
          uploadedAt: true,
          uploadedBy: true,
        },
      }),
      prisma.bankUploadBatch.count(),
    ]);

    res.json({
      success: true,
      data: {
        batches,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + batches.length < total,
        },
      },
    });
  } catch (error: any) {
    logger.error('Error fetching batches:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch batches',
      message: error.message,
    });
  }
});

/**
 * GET /api/bank-reconciliation/variances
 * Get variances requiring review
 */
router.get('/variances', async (req: Request, res: Response): Promise<void> => {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const severity = req.query.severity as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (severity) where.varianceSeverity = severity;
    if (status) where.resolutionStatus = status;

    const [variances, total] = await Promise.all([
      prisma.reconciliationVariance.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { detectedAt: 'desc' },
        include: {
          bankGoalTransaction: {
            include: {
              client: true,
              account: true,
              goal: true,
            },
          },
        },
      }),
      prisma.reconciliationVariance.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        variances: variances.map((v) => ({
          id: v.id,
          type: v.varianceType,
          severity: v.varianceSeverity,
          description: v.description,
          differenceAmount: v.differenceAmount,
          fundCode: v.fundCode,
          resolutionStatus: v.resolutionStatus,
          autoApproved: v.autoApproved,
          detectedAt: v.detectedAt,
          transaction: {
            goalNumber: v.bankGoalTransaction.goalNumber,
            transactionId: v.bankGoalTransaction.transactionId,
            transactionDate: v.bankGoalTransaction.transactionDate,
            totalAmount: v.bankGoalTransaction.totalAmount,
            client: v.bankGoalTransaction.client.clientName,
            accountNumber: v.bankGoalTransaction.account.accountNumber,
          },
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + variances.length < total,
        },
      },
    });
  } catch (error: any) {
    logger.error('Error fetching variances:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch variances',
      message: error.message,
    });
  }
});

/**
 * POST /api/bank-reconciliation/variances/:varianceId/resolve
 * Resolve a variance (approve or reject)
 */
router.post('/variances/:varianceId/resolve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const { varianceId } = req.params;
    const { resolutionStatus, resolutionNotes, resolvedBy } = req.body;

    if (!resolutionStatus || !resolvedBy) {
      res.status(400).json({
        success: false,
        error: 'resolutionStatus and resolvedBy are required',
      });
      return;
    }

    const variance = await prisma.reconciliationVariance.update({
      where: { id: varianceId },
      data: {
        resolutionStatus,
        resolutionNotes,
        resolvedBy,
        resolvedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: variance,
      message: 'Variance resolved successfully',
    });
  } catch (error: any) {
    logger.error('Error resolving variance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve variance',
      message: error.message,
    });
  }
});

export default router;
