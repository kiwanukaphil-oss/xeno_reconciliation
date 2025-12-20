import express, { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import { SmartMatcher } from '../services/reconciliation/SmartMatcher';

const router = express.Router();

/**
 * Get goal-level comparison summary
 * GET /api/goal-comparison
 *
 * Returns aggregated totals per goal showing bank vs fund deposits/withdrawals
 * with variance calculations
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const goalNumber = req.query.goalNumber as string;
    const accountNumber = req.query.accountNumber as string;
    const clientSearch = req.query.clientSearch as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    logger.info('Fetching goal comparison summary', {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      filters: { goalNumber, accountNumber, clientSearch, status },
    });

    const result = await SmartMatcher.getGoalSummary(start, end, {
      goalNumber,
      accountNumber,
      clientSearch,
      status,
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedData = result.data.slice(skip, skip + limit);

    // Calculate overall aggregates
    let totalBankDeposits = 0;
    let totalGoalTxnDeposits = 0;
    let totalBankWithdrawals = 0;
    let totalGoalTxnWithdrawals = 0;
    let matchedCount = 0;
    let varianceCount = 0;

    for (const row of result.data) {
      totalBankDeposits += row.bankDeposits;
      totalGoalTxnDeposits += row.goalTxnDeposits;
      totalBankWithdrawals += row.bankWithdrawals;
      totalGoalTxnWithdrawals += row.goalTxnWithdrawals;
      if (row.status === 'MATCHED') matchedCount++;
      else varianceCount++;
    }

    res.json({
      success: true,
      data: paginatedData,
      aggregates: {
        totalBankDeposits,
        totalGoalTxnDeposits,
        depositVariance: totalBankDeposits - totalGoalTxnDeposits,
        totalBankWithdrawals,
        totalGoalTxnWithdrawals,
        withdrawalVariance: totalBankWithdrawals - totalGoalTxnWithdrawals,
        matchedCount,
        varianceCount,
        matchRate: result.total > 0 ? Math.round((matchedCount / result.total) * 10000) / 100 : 0,
      },
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
      dateRange: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
    });
  } catch (error) {
    logger.error('Error fetching goal comparison:', error);
    next(error);
  }
});

/**
 * Get transactions for a specific goal with smart matching
 * GET /api/goal-comparison/:goalNumber/transactions
 *
 * Returns bank and fund transactions for a goal with match results
 */
router.get('/:goalNumber/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { goalNumber } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const transactionType = req.query.transactionType as 'DEPOSIT' | 'WITHDRAWAL' | undefined;

    if (!goalNumber) {
      throw new AppError(400, 'Goal number is required');
    }

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    logger.info('Fetching goal transactions with matching', {
      goalNumber,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      transactionType,
    });

    const result = await SmartMatcher.getGoalTransactions(
      goalNumber,
      start,
      end,
      transactionType
    );

    // Build response with match info for each bank transaction
    const bankWithMatches = result.bankTransactions.map(bt => {
      const match = result.matches.find(m => m.bankIds.includes(bt.id));
      return {
        ...bt,
        totalAmount: Number(bt.totalAmount),
        xummfAmount: Number(bt.xummfAmount),
        xubfAmount: Number(bt.xubfAmount),
        xudefAmount: Number(bt.xudefAmount),
        xurefAmount: Number(bt.xurefAmount),
        matchInfo: match ? {
          matchType: match.matchType,
          matchedGoalTxnIds: match.fundIds, // fundIds actually refers to fund transaction IDs within goal transactions
          confidence: match.confidence,
          goalTxnTotal: match.fundTotal,
        } : null,
        isMatched: !!match,
      };
    });

    // Build response with match info for each goal transaction
    const goalTxnWithMatches = result.goalTransactions.map(gt => {
      // Check if any of the fund transaction IDs in this goal transaction are matched
      const match = result.matches.find(m =>
        gt.fundTransactionIds.some(ftId => m.fundIds.includes(ftId))
      );
      return {
        ...gt,
        matchInfo: match ? {
          matchType: match.matchType,
          matchedBankIds: match.bankIds,
          confidence: match.confidence,
          bankTotal: match.bankTotal,
        } : null,
        isMatched: !!match,
      };
    });

    res.json({
      success: true,
      goalNumber,
      dateRange: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
      bankTransactions: bankWithMatches,
      goalTransactions: goalTxnWithMatches,
      matches: result.matches,
      summary: {
        bankCount: result.bankTransactions.length,
        goalTxnCount: result.goalTransactions.length,
        matchedBankCount: result.bankTransactions.length - result.unmatchedBank.length,
        matchedGoalTxnCount: result.goalTransactions.length - result.unmatchedGoalTxn.length,
        unmatchedBankCount: result.unmatchedBank.length,
        unmatchedGoalTxnCount: result.unmatchedGoalTxn.length,
        exactMatches: result.matches.filter(m => m.matchType === 'EXACT').length,
        amountMatches: result.matches.filter(m => m.matchType === 'AMOUNT').length,
        splitMatches: result.matches.filter(m => m.matchType.startsWith('SPLIT')).length,
      },
    });
  } catch (error) {
    logger.error('Error fetching goal transactions:', error);
    next(error);
  }
});

/**
 * Export goal comparison summary as CSV
 * GET /api/goal-comparison/export
 */
router.get('/export/csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const goalNumber = req.query.goalNumber as string;
    const accountNumber = req.query.accountNumber as string;
    const clientSearch = req.query.clientSearch as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const result = await SmartMatcher.getGoalSummary(start, end, {
      goalNumber,
      accountNumber,
      clientSearch,
      status,
    });

    // Build CSV
    const headers = [
      'Goal Number',
      'Client Name',
      'Account Number',
      'Bank Deposits',
      'Goal Txn Deposits',
      'Deposit Variance',
      'Deposit Bank Count',
      'Deposit Goal Txn Count',
      'Bank Withdrawals',
      'Goal Txn Withdrawals',
      'Withdrawal Variance',
      'Withdrawal Bank Count',
      'Withdrawal Goal Txn Count',
      'Status',
    ].join(',');

    const rows = result.data.map(row => [
      row.goalNumber,
      `"${row.clientName}"`,
      row.accountNumber,
      row.bankDeposits,
      row.goalTxnDeposits,
      row.depositVariance,
      row.depositBankCount,
      row.depositGoalTxnCount,
      row.bankWithdrawals,
      row.goalTxnWithdrawals,
      row.withdrawalVariance,
      row.withdrawalBankCount,
      row.withdrawalGoalTxnCount,
      row.status,
    ].join(','));

    const csvContent = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="goal_comparison_${start.toISOString().split('T')[0]}_to_${end.toISOString().split('T')[0]}.csv"`
    );
    res.send(csvContent);
  } catch (error) {
    logger.error('Error exporting goal comparison:', error);
    next(error);
  }
});

/**
 * Apply smart matching and update statuses
 * POST /api/goal-comparison/:goalNumber/apply-matches
 */
router.post('/:goalNumber/apply-matches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { goalNumber } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const transactionType = req.query.transactionType as 'DEPOSIT' | 'WITHDRAWAL' | undefined;

    if (!goalNumber) {
      throw new AppError(400, 'Goal number is required');
    }

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    logger.info('Applying smart matching for goal', { goalNumber, startDate: start, endDate: end });

    // Run matching
    const result = await SmartMatcher.getGoalTransactions(goalNumber, start, end, transactionType);

    // Apply matches and update statuses
    const updateResult = await SmartMatcher.applyMatches(result.matches, true);

    res.json({
      success: true,
      message: `Applied ${result.matches.length} matches, updated ${updateResult.updated} transactions`,
      matchesMade: result.matches.length,
      transactionsUpdated: updateResult.updated,
      matchDetails: {
        exact: result.matches.filter(m => m.matchType === 'EXACT').length,
        amount: result.matches.filter(m => m.matchType === 'AMOUNT').length,
        splitBankToFund: result.matches.filter(m => m.matchType === 'SPLIT_BANK_TO_FUND').length,
        splitFundToBank: result.matches.filter(m => m.matchType === 'SPLIT_FUND_TO_BANK').length,
      },
    });
  } catch (error) {
    logger.error('Error applying matches:', error);
    next(error);
  }
});

/**
 * Run smart matching on all goals for a date range (with batch support)
 * POST /api/goal-comparison/run-matching
 *
 * Supports batch processing to handle large datasets:
 * - batchSize: Number of goals to process per batch (default: 100)
 * - offset: Starting offset for batch processing (default: 0)
 *
 * Returns hasMore=true when there are more goals to process
 */
router.post('/run-matching', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, applyUpdates, batchSize = 100, offset = 0 } = req.body;

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    logger.info('Running smart matching for goals (batched)', {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      applyUpdates: !!applyUpdates,
      batchSize,
      offset,
    });

    // Get all goals with transactions in period
    const summary = await SmartMatcher.getGoalSummary(start, end);
    const totalGoals = summary.data.length;

    // Apply batch slicing
    const batchGoals = summary.data.slice(offset, offset + batchSize);
    const processedGoals = offset + batchGoals.length;
    const hasMore = processedGoals < totalGoals;

    let totalMatches = 0;
    let totalUpdated = 0;
    let exactMatches = 0;
    let amountMatches = 0;
    let splitMatches = 0;
    const matchResults: { goalNumber: string; matches: number; updated: number }[] = [];

    // Process each goal in the batch
    for (const goal of batchGoals) {
      const result = await SmartMatcher.getGoalTransactions(goal.goalNumber, start, end);

      if (result.matches.length > 0) {
        totalMatches += result.matches.length;
        exactMatches += result.matches.filter(m => m.matchType === 'EXACT').length;
        amountMatches += result.matches.filter(m => m.matchType === 'AMOUNT').length;
        splitMatches += result.matches.filter(m => m.matchType.startsWith('SPLIT')).length;

        if (applyUpdates) {
          const updateResult = await SmartMatcher.applyMatches(result.matches, true);
          totalUpdated += updateResult.updated;
          matchResults.push({
            goalNumber: goal.goalNumber,
            matches: result.matches.length,
            updated: updateResult.updated,
          });
        } else {
          matchResults.push({
            goalNumber: goal.goalNumber,
            matches: result.matches.length,
            updated: 0,
          });
        }
      }
    }

    res.json({
      success: true,
      message: applyUpdates
        ? `Applied ${totalMatches} matches across ${matchResults.length} goals, updated ${totalUpdated} transactions`
        : `Found ${totalMatches} potential matches across ${matchResults.length} goals (preview only)`,
      // Batch tracking info
      totalGoals,
      processedGoals,
      goalsInBatch: batchGoals.length,
      goalsWithMatches: matchResults.length,
      hasMore,
      nextOffset: hasMore ? processedGoals : null,
      // Match statistics
      totalMatches,
      totalUpdated,
      matchBreakdown: {
        exact: exactMatches,
        amount: amountMatches,
        split: splitMatches,
      },
      dateRange: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
      results: matchResults,
    });
  } catch (error) {
    logger.error('Error running bulk matching:', error);
    next(error);
  }
});

export default router;
