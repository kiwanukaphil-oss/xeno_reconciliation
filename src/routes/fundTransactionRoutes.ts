import { Router, Request, Response } from 'express';
import { FundTransactionService } from '../services/fund-transaction/FundTransactionService';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/fund-transactions
 * Get fund transactions with filters and pagination
 *
 * Query parameters:
 * - startDate: Start date (REQUIRED)
 * - endDate: End date (REQUIRED)
 * - search: Client name or account number
 * - fundCode: Filter by fund (XUMMF, XUBF, XUDEF, XUREF)
 * - transactionType: DEPOSIT or WITHDRAWAL
 * - accountType: PERSONAL, POOLED, JOINT, LINKED
 * - accountCategory: GENERAL, FAMILY, INVESTMENT_CLUBS, RETIREMENTS_BENEFIT_SCHEME
 * - goalTransactionCode: Filter by goal transaction
 * - batchId: Filter by upload batch
 * - page: Page number (default: 1)
 * - limit: Records per page (default: 50, max: 500)
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      startDate,
      endDate,
      search,
      fundCode,
      transactionType,
      accountType,
      accountCategory,
      goalTransactionCode,
      batchId,
      page = '1',
      limit = '50',
    } = req.query;

    // Validate required parameters
    if (!startDate || !endDate) {
      res.status(400).json({
        error: 'Date range is required',
        message: 'Please provide startDate and endDate to prevent timeouts on large datasets',
      });
      return;
    }

    // Validate date range (max 2 years to prevent abuse)
    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > 730) {
      res.status(400).json({
        error: 'Date range too large',
        message: 'Maximum date range is 2 years. Please narrow your search.',
      });
      return;
    }

    const result = await FundTransactionService.getFundTransactions({
      startDate: startDate as string,
      endDate: endDate as string,
      search: search as string,
      fundCode: fundCode as string,
      transactionType: transactionType as string,
      accountType: accountType as string,
      accountCategory: accountCategory as string,
      goalTransactionCode: goalTransactionCode as string,
      batchId: batchId as string,
      page: parseInt(page as string) || 1,
      limit: Math.min(parseInt(limit as string) || 50, 500), // Max 500
    });

    res.json(result);
  } catch (error) {
    logger.error('Error fetching fund transactions:', error);
    res.status(500).json({
      error: 'Failed to fetch fund transactions',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/fund-transactions/summary
 * Get summary statistics for filtered fund transactions
 */
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      startDate,
      endDate,
      search,
      fundCode,
      transactionType,
      accountType,
      accountCategory,
      goalTransactionCode,
      batchId,
    } = req.query;

    // Date range is required
    if (!startDate || !endDate) {
      res.status(400).json({
        error: 'Date range is required',
      });
      return;
    }

    const summary = await FundTransactionService.getSummary({
      startDate: startDate as string,
      endDate: endDate as string,
      search: search as string,
      fundCode: fundCode as string,
      transactionType: transactionType as string,
      accountType: accountType as string,
      accountCategory: accountCategory as string,
      goalTransactionCode: goalTransactionCode as string,
      batchId: batchId as string,
    });

    res.json(summary);
  } catch (error) {
    logger.error('Error fetching fund transaction summary:', error);
    res.status(500).json({
      error: 'Failed to fetch summary',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/fund-transactions/:id
 * Get a specific fund transaction by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const transaction = await FundTransactionService.getById(id);

    if (!transaction) {
      res.status(404).json({
        error: 'Fund transaction not found',
      });
      return;
    }

    res.json(transaction);
  } catch (error) {
    logger.error('Error fetching fund transaction:', error);
    res.status(500).json({
      error: 'Failed to fetch fund transaction',
      message: (error as Error).message,
    });
  }
});

export default router;
