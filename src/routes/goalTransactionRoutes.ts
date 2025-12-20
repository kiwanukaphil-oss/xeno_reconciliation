import express, { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { GoalTransactionService } from '../services/reporting/GoalTransactionService';

const router = express.Router();

/**
 * Get goal transactions (aggregated view)
 * GET /api/goal-transactions
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = (page - 1) * limit;

    const filters = {
      clientId: req.query.clientId as string,
      accountId: req.query.accountId as string,
      goalId: req.query.goalId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      transactionType: req.query.transactionType as string,
      transactionId: req.query.transactionId as string,
      source: req.query.source as string,
      search: req.query.search as string,
    };

    // Get paginated data and total aggregates in parallel
    const [goalTransactions, aggregates] = await Promise.all([
      GoalTransactionService.getGoalTransactions({ ...filters, limit, offset }),
      GoalTransactionService.getAggregates(filters),
    ]);

    res.json({
      data: goalTransactions,
      pagination: {
        page,
        limit,
        total: aggregates.totalCount,
        totalPages: Math.ceil(aggregates.totalCount / limit),
      },
      aggregates: {
        totalCount: aggregates.totalCount,
        totalAmount: aggregates.totalAmount,
        totalXUMMF: aggregates.totalXUMMF,
        totalXUBF: aggregates.totalXUBF,
        totalXUDEF: aggregates.totalXUDEF,
        totalXUREF: aggregates.totalXUREF,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get a single goal transaction by code
 * GET /api/goal-transactions/:goalTransactionCode
 */
router.get('/:goalTransactionCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { goalTransactionCode } = req.params;

    const goalTransaction = await GoalTransactionService.getGoalTransactionByCode(
      goalTransactionCode
    );

    if (!goalTransaction) {
      throw new AppError(404, 'Goal transaction not found');
    }

    res.json(goalTransaction);
  } catch (error) {
    next(error);
  }
});

/**
 * Get fund transactions for a goal transaction
 * GET /api/goal-transactions/:goalTransactionCode/fund-transactions
 */
router.get(
  '/:goalTransactionCode/fund-transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { goalTransactionCode } = req.params;

      const fundTransactions = await GoalTransactionService.getFundTransactionsForGoal(
        goalTransactionCode
      );

      res.json({
        goalTransactionCode,
        count: fundTransactions.length,
        fundTransactions,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Export goal transactions to CSV
 * GET /api/goal-transactions/export/csv
 */
router.get('/export/csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      clientId: req.query.clientId as string,
      accountId: req.query.accountId as string,
      goalId: req.query.goalId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      transactionId: req.query.transactionId as string,
      source: req.query.source as string,
      search: req.query.search as string,
    };

    const csv = await GoalTransactionService.exportGoalTransactionsCSV(filters);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=goal-transactions.csv');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/**
 * Get goal transaction statistics
 * GET /api/goal-transactions/stats
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      clientId: req.query.clientId as string,
      accountId: req.query.accountId as string,
      goalId: req.query.goalId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      search: req.query.search as string,
    };

    const stats = await GoalTransactionService.getStatistics(filters);

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

export default router;
