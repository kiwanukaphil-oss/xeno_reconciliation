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
    const search = req.query.search as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Default to last 30 days if no dates provided
    // Use date strings directly to avoid timezone issues with PostgreSQL
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    logger.info('Fetching goal comparison summary', {
      startDate: startDateStr,
      endDate: endDateStr,
      filters: { search, status },
    });

    const result = await SmartMatcher.getGoalSummary(startDateStr, endDateStr, {
      search,
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
        startDate: startDateStr,
        endDate: endDateStr,
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
 * Get fund-level comparison summary
 * GET /api/goal-comparison/fund-summary
 *
 * Returns aggregated NET amounts per fund (XUMMF, XUBF, XUDEF, XUREF) for each goal
 * with variance calculations
 */
router.get('/fund-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Default to last 30 days if no dates provided
    // Use date strings directly to avoid timezone issues with PostgreSQL
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    logger.info('Fetching fund comparison summary', {
      startDate: startDateStr,
      endDate: endDateStr,
      filters: { search, status },
    });

    const result = await SmartMatcher.getFundSummary(startDateStr, endDateStr, {
      search,
      status,
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedData = result.data.slice(skip, skip + limit);

    // Calculate overall aggregates
    let totalBankXUMMF = 0;
    let totalBankXUBF = 0;
    let totalBankXUDEF = 0;
    let totalBankXUREF = 0;
    let totalBankAmount = 0;
    let totalGoalXUMMF = 0;
    let totalGoalXUBF = 0;
    let totalGoalXUDEF = 0;
    let totalGoalXUREF = 0;
    let totalGoalAmount = 0;
    let matchedCount = 0;
    let varianceCount = 0;

    for (const row of result.data) {
      totalBankXUMMF += row.bankXUMMF;
      totalBankXUBF += row.bankXUBF;
      totalBankXUDEF += row.bankXUDEF;
      totalBankXUREF += row.bankXUREF;
      totalBankAmount += row.bankTotal;
      totalGoalXUMMF += row.goalXUMMF;
      totalGoalXUBF += row.goalXUBF;
      totalGoalXUDEF += row.goalXUDEF;
      totalGoalXUREF += row.goalXUREF;
      totalGoalAmount += row.goalTotal;
      if (row.status === 'MATCHED') matchedCount++;
      else varianceCount++;
    }

    res.json({
      success: true,
      data: paginatedData,
      aggregates: {
        totalBankXUMMF,
        totalGoalXUMMF,
        xummfVariance: totalBankXUMMF - totalGoalXUMMF,
        totalBankXUBF,
        totalGoalXUBF,
        xubfVariance: totalBankXUBF - totalGoalXUBF,
        totalBankXUDEF,
        totalGoalXUDEF,
        xudefVariance: totalBankXUDEF - totalGoalXUDEF,
        totalBankXUREF,
        totalGoalXUREF,
        xurefVariance: totalBankXUREF - totalGoalXUREF,
        totalBankAmount,
        totalGoalAmount,
        totalVariance: totalBankAmount - totalGoalAmount,
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
        startDate: startDateStr,
        endDate: endDateStr,
      },
    });
  } catch (error) {
    logger.error('Error fetching fund comparison:', error);
    next(error);
  }
});

/**
 * Get account-level fund comparison summary
 * GET /api/goal-comparison/fund-summary/by-account
 *
 * Aggregates fund variances by account number (summing all goals within each account)
 * Returns account-level summary with goal counts and matched/variance breakdowns
 */
router.get('/fund-summary/by-account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Default to last 30 days if no dates provided
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    logger.info('Fetching account-level fund comparison summary', {
      startDate: startDateStr,
      endDate: endDateStr,
      filters: { search, status },
    });

    const result = await SmartMatcher.getAccountFundSummary(startDateStr, endDateStr, {
      search,
      status,
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedData = result.data.slice(skip, skip + limit);

    // Calculate overall aggregates
    let totalBankXUMMF = 0;
    let totalBankXUBF = 0;
    let totalBankXUDEF = 0;
    let totalBankXUREF = 0;
    let totalBankAmount = 0;
    let totalGoalXUMMF = 0;
    let totalGoalXUBF = 0;
    let totalGoalXUDEF = 0;
    let totalGoalXUREF = 0;
    let totalGoalAmount = 0;
    let matchedCount = 0;
    let varianceCount = 0;
    let totalGoalCount = 0;
    let totalMatchedGoalCount = 0;
    let totalVarianceGoalCount = 0;

    for (const row of result.data) {
      totalBankXUMMF += row.bankXUMMF;
      totalBankXUBF += row.bankXUBF;
      totalBankXUDEF += row.bankXUDEF;
      totalBankXUREF += row.bankXUREF;
      totalBankAmount += row.bankTotal;
      totalGoalXUMMF += row.goalXUMMF;
      totalGoalXUBF += row.goalXUBF;
      totalGoalXUDEF += row.goalXUDEF;
      totalGoalXUREF += row.goalXUREF;
      totalGoalAmount += row.goalTotal;
      totalGoalCount += row.goalCount;
      totalMatchedGoalCount += row.matchedGoalCount;
      totalVarianceGoalCount += row.varianceGoalCount;
      if (row.status === 'MATCHED') matchedCount++;
      else varianceCount++;
    }

    res.json({
      success: true,
      data: paginatedData,
      aggregates: {
        totalBankXUMMF,
        totalGoalXUMMF,
        xummfVariance: totalBankXUMMF - totalGoalXUMMF,
        totalBankXUBF,
        totalGoalXUBF,
        xubfVariance: totalBankXUBF - totalGoalXUBF,
        totalBankXUDEF,
        totalGoalXUDEF,
        xudefVariance: totalBankXUDEF - totalGoalXUDEF,
        totalBankXUREF,
        totalGoalXUREF,
        xurefVariance: totalBankXUREF - totalGoalXUREF,
        totalBankAmount,
        totalGoalAmount,
        totalVariance: totalBankAmount - totalGoalAmount,
        matchedCount,
        varianceCount,
        matchRate: result.total > 0 ? Math.round((matchedCount / result.total) * 10000) / 100 : 0,
        totalGoalCount,
        totalMatchedGoalCount,
        totalVarianceGoalCount,
      },
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr,
      },
    });
  } catch (error) {
    logger.error('Error fetching account-level fund comparison:', error);
    next(error);
  }
});

/**
 * Export fund comparison summary as CSV
 * GET /api/goal-comparison/fund-summary/export/csv
 */
router.get('/fund-summary/export/csv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const search = req.query.search as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';

    // Default to last 30 days if no dates provided
    // Use date strings directly to avoid timezone issues with PostgreSQL
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await SmartMatcher.getFundSummary(startDateStr, endDateStr, {
      search,
      status,
    });

    // Build CSV
    const headers = [
      'Goal Number',
      'Client Name',
      'Account Number',
      'Bank XUMMF',
      'Goal XUMMF',
      'XUMMF Variance',
      'Bank XUBF',
      'Goal XUBF',
      'XUBF Variance',
      'Bank XUDEF',
      'Goal XUDEF',
      'XUDEF Variance',
      'Bank XUREF',
      'Goal XUREF',
      'XUREF Variance',
      'Bank Total',
      'Goal Total',
      'Total Variance',
      'Status',
    ].join(',');

    const rows = result.data.map(row => [
      row.goalNumber,
      `"${row.clientName}"`,
      row.accountNumber,
      row.bankXUMMF,
      row.goalXUMMF,
      row.xummfVariance,
      row.bankXUBF,
      row.goalXUBF,
      row.xubfVariance,
      row.bankXUDEF,
      row.goalXUDEF,
      row.xudefVariance,
      row.bankXUREF,
      row.goalXUREF,
      row.xurefVariance,
      row.bankTotal,
      row.goalTotal,
      row.totalVariance,
      row.status,
    ].join(','));

    const csvContent = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fund_comparison_${startDateStr}_to_${endDateStr}.csv"`
    );
    res.send(csvContent);
  } catch (error) {
    logger.error('Error exporting fund comparison:', error);
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
    const search = req.query.search as string;
    const status = req.query.status as 'ALL' | 'MATCHED' | 'VARIANCE';

    // Default to last 30 days if no dates provided
    // Use date strings directly to avoid timezone issues with PostgreSQL
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await SmartMatcher.getGoalSummary(startDateStr, endDateStr, {
      search,
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
      `attachment; filename="goal_comparison_${startDateStr}_to_${endDateStr}.csv"`
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
    // Use date strings directly to avoid timezone issues with PostgreSQL
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    // Also create Date objects for Prisma queries that need them
    const startDateObj = new Date(startDateStr + 'T00:00:00');
    const endDateObj = new Date(endDateStr + 'T23:59:59');

    logger.info('Running smart matching for goals (batched)', {
      startDate: startDateStr,
      endDate: endDateStr,
      applyUpdates: !!applyUpdates,
      batchSize,
      offset,
    });

    // Get all goals with transactions in period
    const summary = await SmartMatcher.getGoalSummary(startDateStr, endDateStr);
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
      const result = await SmartMatcher.getGoalTransactions(goal.goalNumber, startDateObj, endDateObj);

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
        startDate: startDateStr,
        endDate: endDateStr,
      },
      results: matchResults,
    });
  } catch (error) {
    logger.error('Error running bulk matching:', error);
    next(error);
  }
});

// ============================================================================
// VARIANCE REVIEW ENDPOINTS
// ============================================================================

/**
 * Review a single bank transaction
 * POST /api/goal-comparison/bank-transactions/:transactionId/review
 */
router.post('/bank-transactions/:transactionId/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.params;
    const { reviewTag, reviewNotes, reviewedBy } = req.body;

    if (!transactionId) {
      throw new AppError(400, 'Transaction ID is required');
    }

    if (!reviewTag) {
      throw new AppError(400, 'Review tag is required');
    }

    if (!reviewedBy) {
      throw new AppError(400, 'Reviewed by is required');
    }

    const result = await SmartMatcher.reviewBankTransaction(
      transactionId,
      reviewTag,
      reviewNotes || null,
      reviewedBy
    );

    res.json(result);
  } catch (error) {
    logger.error('Error reviewing bank transaction:', error);
    next(error);
  }
});

/**
 * Review goal transactions by goalTransactionCode
 * POST /api/goal-comparison/goal-transactions/:goalTransactionCode/review
 */
router.post('/goal-transactions/:goalTransactionCode/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { goalTransactionCode } = req.params;
    const { reviewTag, reviewNotes, reviewedBy } = req.body;

    if (!goalTransactionCode) {
      throw new AppError(400, 'Goal transaction code is required');
    }

    if (!reviewTag) {
      throw new AppError(400, 'Review tag is required');
    }

    if (!reviewedBy) {
      throw new AppError(400, 'Reviewed by is required');
    }

    const result = await SmartMatcher.reviewGoalTransaction(
      goalTransactionCode,
      reviewTag,
      reviewNotes || null,
      reviewedBy
    );

    res.json(result);
  } catch (error) {
    logger.error('Error reviewing goal transaction:', error);
    next(error);
  }
});

/**
 * Bulk review multiple transactions
 * POST /api/goal-comparison/review/bulk
 */
router.post('/review/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bankTransactionIds, goalTransactionCodes, reviewTag, reviewNotes, reviewedBy } = req.body;

    if (!reviewTag) {
      throw new AppError(400, 'Review tag is required');
    }

    if (!reviewedBy) {
      throw new AppError(400, 'Reviewed by is required');
    }

    const result = await SmartMatcher.bulkReview(
      bankTransactionIds || [],
      goalTransactionCodes || [],
      reviewTag,
      reviewNotes || null,
      reviewedBy
    );

    res.json({
      success: true,
      updated: result,
    });
  } catch (error) {
    logger.error('Error bulk reviewing transactions:', error);
    next(error);
  }
});

/**
 * Create a manual match between bank and goal transactions
 * POST /api/goal-comparison/manual-match
 *
 * Links selected bank transactions to selected goal transactions
 * Validates that totals match within tolerance
 */
router.post('/manual-match', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bankTransactionIds, goalTransactionCodes, matchedBy } = req.body;

    if (!bankTransactionIds || bankTransactionIds.length === 0) {
      throw new AppError(400, 'At least one bank transaction is required');
    }

    if (!goalTransactionCodes || goalTransactionCodes.length === 0) {
      throw new AppError(400, 'At least one goal transaction is required');
    }

    if (!matchedBy) {
      throw new AppError(400, 'Matched by is required');
    }

    logger.info('Creating manual match', {
      bankTransactionIds,
      goalTransactionCodes,
      matchedBy,
    });

    const result = await SmartMatcher.createManualMatch(
      bankTransactionIds,
      goalTransactionCodes,
      matchedBy
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Error creating manual match:', error);
    next(error);
  }
});

/**
 * Remove a manual match
 * DELETE /api/goal-comparison/manual-match
 *
 * Unlinks bank transactions from their matched goal transactions
 */
router.delete('/manual-match', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bankTransactionIds, goalTransactionCodes } = req.body;

    if ((!bankTransactionIds || bankTransactionIds.length === 0) &&
        (!goalTransactionCodes || goalTransactionCodes.length === 0)) {
      throw new AppError(400, 'At least one bank transaction or goal transaction is required');
    }

    logger.info('Removing manual match', {
      bankTransactionIds,
      goalTransactionCodes,
    });

    const result = await SmartMatcher.removeManualMatch(
      bankTransactionIds || [],
      goalTransactionCodes || []
    );

    res.json({
      success: true,
      unmatched: result,
    });
  } catch (error) {
    logger.error('Error removing manual match:', error);
    next(error);
  }
});

/**
 * Get review status for a specific goal
 * GET /api/goal-comparison/:goalNumber/review-status
 */
router.get('/:goalNumber/review-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { goalNumber } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (!goalNumber) {
      throw new AppError(400, 'Goal number is required');
    }

    // Default to last 30 days if no dates provided
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await SmartMatcher.getGoalReviewStatus(goalNumber, startDateStr, endDateStr);

    res.json(result);
  } catch (error) {
    logger.error('Error getting goal review status:', error);
    next(error);
  }
});

/**
 * Get all variance transactions for review
 * GET /api/goal-comparison/variance-transactions
 */
router.get('/variance-transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const reviewStatus = req.query.reviewStatus as 'PENDING' | 'REVIEWED' | 'ALL';
    const reviewTag = req.query.reviewTag as string;
    const search = req.query.search as string;
    const resolutionStatus = req.query.resolutionStatus as 'RESOLVED' | 'PENDING' | 'ALL';
    const transactionSource = req.query.transactionSource as 'BANK' | 'GOAL' | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    // Default to last 30 days if no dates provided
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await SmartMatcher.getVarianceTransactions(startDateStr, endDateStr, {
      reviewStatus,
      reviewTag,
      search,
      resolutionStatus,
      transactionSource,
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedData = result.data.slice(skip, skip + limit);

    res.json({
      success: true,
      data: paginatedData,
      summary: result.summary,
      pagination: {
        page,
        limit,
        total: result.data.length,
        totalPages: Math.ceil(result.data.length / limit),
      },
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr,
      },
    });
  } catch (error) {
    logger.error('Error getting variance transactions:', error);
    next(error);
  }
});

/**
 * Export variance transactions to Excel
 * GET /api/goal-comparison/variance-transactions/export
 */
router.get('/variance-transactions/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const reviewStatus = req.query.reviewStatus as 'PENDING' | 'REVIEWED' | 'ALL';
    const reviewTag = req.query.reviewTag as string;
    const search = req.query.search as string;
    const resolutionStatus = req.query.resolutionStatus as 'RESOLVED' | 'PENDING' | 'ALL';
    const transactionSource = req.query.transactionSource as 'BANK' | 'GOAL' | undefined;

    // Default to last 30 days if no dates provided
    const endDateStr = endDate || new Date().toISOString().split('T')[0];
    const startDateStr = startDate || new Date(new Date(endDateStr).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await SmartMatcher.getVarianceTransactions(startDateStr, endDateStr, {
      reviewStatus,
      reviewTag,
      search,
      resolutionStatus,
      transactionSource,
    });

    // Create Excel workbook
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();

    // Main data sheet
    const worksheet = workbook.addWorksheet('Variance Transactions');

    // Define columns - includes fund distribution for actionable exports
    worksheet.columns = [
      { header: 'Source', key: 'transactionSource', width: 10 },
      { header: 'Goal Number', key: 'goalNumber', width: 25 },
      { header: 'Client Name', key: 'clientName', width: 30 },
      { header: 'Account Number', key: 'accountNumber', width: 20 },
      { header: 'Transaction Date', key: 'transactionDate', width: 15 },
      { header: 'Type', key: 'transactionType', width: 12 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'XUMMF', key: 'xummfAmount', width: 15 },
      { header: 'XUBF', key: 'xubfAmount', width: 15 },
      { header: 'XUDEF', key: 'xudefAmount', width: 15 },
      { header: 'XUREF', key: 'xurefAmount', width: 15 },
      { header: 'Source Txn ID', key: 'sourceTransactionId', width: 15 },
      { header: 'Review Tag', key: 'reviewTag', width: 25 },
      { header: 'Review Notes', key: 'reviewNotes', width: 40 },
      { header: 'Reviewed By', key: 'reviewedBy', width: 15 },
      { header: 'Reviewed At', key: 'reviewedAt', width: 20 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    for (const row of result.data) {
      worksheet.addRow({
        transactionSource: row.transactionSource,
        goalNumber: row.goalNumber,
        clientName: row.clientName,
        accountNumber: row.accountNumber,
        transactionDate: row.transactionDate ? new Date(row.transactionDate).toISOString().split('T')[0] : '',
        transactionType: row.transactionType,
        amount: row.amount,
        xummfAmount: row.xummfAmount || 0,
        xubfAmount: row.xubfAmount || 0,
        xudefAmount: row.xudefAmount || 0,
        xurefAmount: row.xurefAmount || 0,
        sourceTransactionId: row.sourceTransactionId || '',
        reviewTag: row.reviewTag ? row.reviewTag.replace(/_/g, ' ') : '',
        reviewNotes: row.reviewNotes || '',
        reviewedBy: row.reviewedBy || '',
        reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString().replace('T', ' ').slice(0, 19) : '',
      });
    }

    // Add conditional formatting for review tags
    const tagColors: Record<string, string> = {
      'DUPLICATE_TRANSACTION': 'FFFFE0E0',
      'NO_ACTION_NEEDED': 'FFE0FFE0',
      'MISSING_IN_BANK': 'FFFFF0E0',
      'MISSING_IN_GOAL': 'FFE0F0FF',
      'TIMING_DIFFERENCE': 'FFF0E0FF',
      'AMOUNT_DISCREPANCY': 'FFFFFFE0',
      'DATA_ENTRY_ERROR': 'FFFFD0D0',
      'UNDER_INVESTIGATION': 'FFD0D0FF',
    };

    // Review Tag is now column M (after adding 4 fund columns)
    for (let i = 2; i <= result.data.length + 1; i++) {
      const cell = worksheet.getCell(`M${i}`);
      const tag = result.data[i - 2]?.reviewTag;
      if (tag && tagColors[tag]) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: tagColors[tag] },
        };
      }
    }

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 25 },
      { header: 'Value', key: 'value', width: 15 },
    ];
    summarySheet.getRow(1).font = { bold: true };

    summarySheet.addRow({ metric: 'Date Range', value: `${startDateStr} to ${endDateStr}` });
    summarySheet.addRow({ metric: 'Total Unmatched', value: result.summary.totalUnmatched });
    summarySheet.addRow({ metric: 'Pending Review', value: result.summary.pendingReview });
    summarySheet.addRow({ metric: 'Reviewed', value: result.summary.reviewed });
    summarySheet.addRow({ metric: '', value: '' });
    summarySheet.addRow({ metric: 'By Tag:', value: '' });

    for (const [tag, count] of Object.entries(result.summary.byTag)) {
      summarySheet.addRow({ metric: tag.replace(/_/g, ' '), value: count });
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="variance_review_${startDateStr}_to_${endDateStr}.xlsx"`
    );

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error('Error exporting variance transactions:', error);
    next(error);
  }
});

// ============================================================================
// REVERSAL LINKING ENDPOINTS
// ============================================================================

/**
 * Find potential reversal candidates for a bank transaction
 * GET /api/goal-comparison/reversal-candidates/:transactionId
 *
 * Returns unmatched transactions with same goal, same absolute amount, opposite type
 */
router.get('/reversal-candidates/:transactionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.params;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (!transactionId) {
      throw new AppError(400, 'Transaction ID is required');
    }

    const dateRange = startDate && endDate
      ? { startDate, endDate }
      : undefined;

    const result = await SmartMatcher.findReversalCandidates(transactionId, dateRange);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Error finding reversal candidates:', error);
    next(error);
  }
});

/**
 * Link two bank transactions as a reversal pair
 * POST /api/goal-comparison/link-reversal
 *
 * Both transactions get REVERSAL_NETTED tag and are linked together
 * Validates: same goal, same absolute amount, opposite types
 */
router.post('/link-reversal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId1, transactionId2, linkedBy } = req.body;

    if (!transactionId1 || !transactionId2) {
      throw new AppError(400, 'Both transaction IDs are required');
    }

    if (!linkedBy) {
      throw new AppError(400, 'Linked by is required');
    }

    const result = await SmartMatcher.linkReversal(transactionId1, transactionId2, linkedBy);

    res.json(result);
  } catch (error) {
    logger.error('Error linking reversal:', error);
    next(error);
  }
});

/**
 * Unlink a reversal pair
 * DELETE /api/goal-comparison/unlink-reversal/:transactionId
 *
 * Removes REVERSAL_NETTED tag from both transactions in the pair
 */
router.delete('/unlink-reversal/:transactionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      throw new AppError(400, 'Transaction ID is required');
    }

    const result = await SmartMatcher.unlinkReversal(transactionId);

    res.json(result);
  } catch (error) {
    logger.error('Error unlinking reversal:', error);
    next(error);
  }
});

/**
 * Get reversal pair info for a transaction
 * GET /api/goal-comparison/reversal-info/:transactionId
 *
 * Returns paired transaction details if this transaction is part of a reversal pair
 */
router.get('/reversal-info/:transactionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      throw new AppError(400, 'Transaction ID is required');
    }

    const result = await SmartMatcher.getReversalPairInfo(transactionId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Error getting reversal info:', error);
    next(error);
  }
});

export default router;
