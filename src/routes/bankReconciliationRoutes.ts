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
  destination: async (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads/temp';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `bank-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024),
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
      cb(new Error('Only CSV files are allowed'));
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /api/bank-reconciliation/upload
 * Upload bank transaction CSV file for reconciliation
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

      logger.info(`Bank transaction upload started: ${req.file.originalname}`);

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

      // Process upload
      const result = await reconciliationService.processUpload(
        req.file.path,
        req.file.originalname,
        uploadedBy,
        parsedMetadata
      );

      res.status(200).json({
        success: true,
        data: result,
        message: 'Bank transaction upload processed successfully',
      });
    } catch (error: any) {
      logger.error('Error processing bank upload:', error);

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
        error: 'Failed to process bank upload',
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
