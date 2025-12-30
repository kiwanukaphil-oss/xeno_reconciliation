import { PrismaClient, VarianceReviewTag } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

// Tolerance settings (same as SmartMatcher)
const AMOUNT_TOLERANCE_PERCENT = 0.01; // 1%
const AMOUNT_TOLERANCE_MIN = 1000; // 1000 UGX minimum
const DATE_WINDOW_DAYS = 30;
const TIMING_TOLERANCE_DAYS = 3; // For TIMING_DIFFERENCE resolution

// Only these tags can be auto-resolved: MISSING_IN_GOAL, MISSING_IN_BANK, TIMING_DIFFERENCE

interface ResolutionResult {
  id: string;
  source: 'BANK' | 'GOAL';
  goalNumber: string;
  transactionId: string | null;
  amount: number;
  originalTag: VarianceReviewTag;
  resolvedReason: string;
}

interface DetectionResult {
  resolved: number;
  byTag: Record<string, number>;
  details: ResolutionResult[];
}

/**
 * Service to detect when reviewed variances have been resolved by new uploads
 *
 * Auto-resolvable tags:
 * - MISSING_IN_GOAL: Bank transaction was tagged because no matching goal transaction existed
 *   → Resolved when a matching goal transaction now exists
 * - MISSING_IN_BANK: Goal transaction was tagged because no matching bank transaction existed
 *   → Resolved when a matching bank transaction now exists
 * - TIMING_DIFFERENCE: Transaction was tagged because dates didn't align
 *   → Resolved when a transaction with same ID now has dates within ±3 days
 */
export class VarianceResolutionService {

  /**
   * Main entry point - detect and mark resolved variances
   * @param triggeredByBatchId - Optional batch ID that triggered this detection
   * @param dateRange - Optional date range to limit the search
   */
  static async detectResolvedVariances(
    triggeredByBatchId?: string,
    dateRange?: { startDate: string; endDate: string }
  ): Promise<DetectionResult> {
    logger.info('Starting variance resolution detection', {
      triggeredByBatchId,
      dateRange,
    });

    const results: ResolutionResult[] = [];

    // Check each resolvable tag type
    const missingInGoalResolved = await this.checkMissingInGoalResolved(dateRange);
    const missingInBankResolved = await this.checkMissingInBankResolved(dateRange);
    const timingDifferenceResolved = await this.checkTimingDifferenceResolved(dateRange);

    results.push(...missingInGoalResolved, ...missingInBankResolved, ...timingDifferenceResolved);

    // Mark all detected resolutions in the database
    if (results.length > 0) {
      await this.markAsResolved(results, triggeredByBatchId || null);
    }

    // Aggregate by tag
    const byTag: Record<string, number> = {};
    for (const r of results) {
      byTag[r.originalTag] = (byTag[r.originalTag] || 0) + 1;
    }

    logger.info('Variance resolution detection completed', {
      totalResolved: results.length,
      byTag,
    });

    return {
      resolved: results.length,
      byTag,
      details: results,
    };
  }

  /**
   * Check if bank transactions tagged MISSING_IN_GOAL now have matching goal transactions
   */
  private static async checkMissingInGoalResolved(
    dateRange?: { startDate: string; endDate: string }
  ): Promise<ResolutionResult[]> {
    const results: ResolutionResult[] = [];

    // Find bank transactions tagged MISSING_IN_GOAL that are not yet resolved
    let dateFilter = '';
    const params: any[] = [];

    if (dateRange) {
      dateFilter = 'AND b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date';
      params.push(dateRange.startDate, dateRange.endDate);
    }

    const query = `
      SELECT
        b.id,
        b."goalNumber",
        b."transactionId",
        b."transactionType",
        b."totalAmount",
        b."transactionDate"
      FROM bank_goal_transactions b
      WHERE b."reviewTag" = 'MISSING_IN_GOAL'
        AND b."varianceResolved" = false
        ${dateFilter}
    `;

    const bankTxns = await prisma.$queryRawUnsafe(query, ...params) as any[];

    for (const bankTxn of bankTxns) {
      // Check if a matching goal transaction now exists
      // Match by: goalNumber + transactionId + transactionType + amount within tolerance + date within window
      const goalMatch = await this.findMatchingGoalTransaction(
        bankTxn.goalNumber,
        bankTxn.transactionId,
        bankTxn.transactionType,
        Number(bankTxn.totalAmount),
        new Date(bankTxn.transactionDate)
      );

      if (goalMatch) {
        results.push({
          id: bankTxn.id,
          source: 'BANK',
          goalNumber: bankTxn.goalNumber,
          transactionId: bankTxn.transactionId,
          amount: Number(bankTxn.totalAmount),
          originalTag: 'MISSING_IN_GOAL',
          resolvedReason: `Matching goal transaction found: ${goalMatch.goalTransactionCode}`,
        });
      }
    }

    return results;
  }

  /**
   * Check if goal transactions tagged MISSING_IN_BANK now have matching bank transactions
   */
  private static async checkMissingInBankResolved(
    dateRange?: { startDate: string; endDate: string }
  ): Promise<ResolutionResult[]> {
    const results: ResolutionResult[] = [];

    // Find goal transactions (grouped by goalTransactionCode) tagged MISSING_IN_BANK that are not yet resolved
    let dateFilter = '';
    const params: any[] = [];

    if (dateRange) {
      dateFilter = 'AND f."transactionDate"::date >= $1::date AND f."transactionDate"::date <= $2::date';
      params.push(dateRange.startDate, dateRange.endDate);
    }

    const query = `
      SELECT
        f."goalTransactionCode",
        g."goalNumber",
        f."transactionId",
        f."transactionType",
        SUM(f."amount") as total_amount,
        MIN(f."transactionDate") as transaction_date
      FROM fund_transactions f
      JOIN goals g ON f."goalId" = g.id
      WHERE f."reviewTag" = 'MISSING_IN_BANK'
        AND f."varianceResolved" = false
        ${dateFilter}
      GROUP BY f."goalTransactionCode", g."goalNumber", f."transactionId", f."transactionType"
    `;

    const goalTxns = await prisma.$queryRawUnsafe(query, ...params) as any[];

    for (const goalTxn of goalTxns) {
      // Check if a matching bank transaction now exists
      const bankMatch = await this.findMatchingBankTransaction(
        goalTxn.goalNumber,
        goalTxn.transactionId,
        goalTxn.transactionType,
        Number(goalTxn.total_amount),
        new Date(goalTxn.transaction_date)
      );

      if (bankMatch) {
        results.push({
          id: goalTxn.goalTransactionCode,
          source: 'GOAL',
          goalNumber: goalTxn.goalNumber,
          transactionId: goalTxn.transactionId,
          amount: Number(goalTxn.total_amount),
          originalTag: 'MISSING_IN_BANK',
          resolvedReason: `Matching bank transaction found: ${bankMatch.transactionId}`,
        });
      }
    }

    return results;
  }

  /**
   * Check if transactions tagged TIMING_DIFFERENCE now have dates that align
   */
  private static async checkTimingDifferenceResolved(
    dateRange?: { startDate: string; endDate: string }
  ): Promise<ResolutionResult[]> {
    const results: ResolutionResult[] = [];

    // Check bank transactions tagged TIMING_DIFFERENCE
    let dateFilter = '';
    const params: any[] = [];

    if (dateRange) {
      dateFilter = 'AND b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date';
      params.push(dateRange.startDate, dateRange.endDate);
    }

    const bankQuery = `
      SELECT
        b.id,
        b."goalNumber",
        b."transactionId",
        b."transactionType",
        b."totalAmount",
        b."transactionDate"
      FROM bank_goal_transactions b
      WHERE b."reviewTag" = 'TIMING_DIFFERENCE'
        AND b."varianceResolved" = false
        ${dateFilter}
    `;

    const bankTxns = await prisma.$queryRawUnsafe(bankQuery, ...params) as any[];

    for (const bankTxn of bankTxns) {
      // Check if there's now a goal transaction with dates within ±3 days
      const goalMatch = await this.findGoalTransactionWithinTimingTolerance(
        bankTxn.goalNumber,
        bankTxn.transactionId,
        bankTxn.transactionType,
        Number(bankTxn.totalAmount),
        new Date(bankTxn.transactionDate)
      );

      if (goalMatch) {
        results.push({
          id: bankTxn.id,
          source: 'BANK',
          goalNumber: bankTxn.goalNumber,
          transactionId: bankTxn.transactionId,
          amount: Number(bankTxn.totalAmount),
          originalTag: 'TIMING_DIFFERENCE',
          resolvedReason: `Date now within tolerance. Bank: ${new Date(bankTxn.transactionDate).toISOString().split('T')[0]}, Goal: ${goalMatch.transactionDate}`,
        });
      }
    }

    // Check goal transactions tagged TIMING_DIFFERENCE
    const goalQuery = `
      SELECT
        f."goalTransactionCode",
        g."goalNumber",
        f."transactionId",
        f."transactionType",
        SUM(f."amount") as total_amount,
        MIN(f."transactionDate") as transaction_date
      FROM fund_transactions f
      JOIN goals g ON f."goalId" = g.id
      WHERE f."reviewTag" = 'TIMING_DIFFERENCE'
        AND f."varianceResolved" = false
        ${dateFilter ? dateFilter.replace(/b\./g, 'f.') : ''}
      GROUP BY f."goalTransactionCode", g."goalNumber", f."transactionId", f."transactionType"
    `;

    const goalTxns = await prisma.$queryRawUnsafe(goalQuery, ...params) as any[];

    for (const goalTxn of goalTxns) {
      // Check if there's now a bank transaction with dates within ±3 days
      const bankMatch = await this.findBankTransactionWithinTimingTolerance(
        goalTxn.goalNumber,
        goalTxn.transactionId,
        goalTxn.transactionType,
        Number(goalTxn.total_amount),
        new Date(goalTxn.transaction_date)
      );

      if (bankMatch) {
        results.push({
          id: goalTxn.goalTransactionCode,
          source: 'GOAL',
          goalNumber: goalTxn.goalNumber,
          transactionId: goalTxn.transactionId,
          amount: Number(goalTxn.total_amount),
          originalTag: 'TIMING_DIFFERENCE',
          resolvedReason: `Date now within tolerance. Goal: ${new Date(goalTxn.transaction_date).toISOString().split('T')[0]}, Bank: ${bankMatch.transactionDate}`,
        });
      }
    }

    return results;
  }

  /**
   * Find a matching goal transaction
   */
  private static async findMatchingGoalTransaction(
    goalNumber: string,
    transactionId: string | null,
    transactionType: string,
    amount: number,
    transactionDate: Date
  ): Promise<{ goalTransactionCode: string } | null> {
    const tolerance = Math.max(Math.abs(amount) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
    const minDate = new Date(transactionDate);
    minDate.setDate(minDate.getDate() - DATE_WINDOW_DAYS);
    const maxDate = new Date(transactionDate);
    maxDate.setDate(maxDate.getDate() + DATE_WINDOW_DAYS);

    // Convert to strings for proper PostgreSQL binding
    const amountStr = String(amount);
    const toleranceStr = String(tolerance);

    // First try exact transactionId match
    if (transactionId) {
      const exactMatch = await prisma.$queryRawUnsafe(`
        SELECT f."goalTransactionCode", SUM(f."amount") as total
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g.id
        WHERE g."goalNumber" = $1
          AND f."transactionId" = $2
          AND f."transactionType"::text = $3
        GROUP BY f."goalTransactionCode"
        HAVING ABS(SUM(f."amount") - $4::numeric) <= $5::numeric
        LIMIT 1
      `, goalNumber, transactionId, transactionType, amountStr, toleranceStr) as any[];

      if (exactMatch.length > 0) {
        return { goalTransactionCode: exactMatch[0].goalTransactionCode };
      }
    }

    // Fall back to amount + date window match
    const windowMatch = await prisma.$queryRawUnsafe(`
      SELECT f."goalTransactionCode", SUM(f."amount") as total
      FROM fund_transactions f
      JOIN goals g ON f."goalId" = g.id
      WHERE g."goalNumber" = $1
        AND f."transactionType"::text = $2
        AND f."transactionDate" >= $3
        AND f."transactionDate" <= $4
      GROUP BY f."goalTransactionCode"
      HAVING ABS(SUM(f."amount") - $5::numeric) <= $6::numeric
      LIMIT 1
    `, goalNumber, transactionType, minDate, maxDate, amountStr, toleranceStr) as any[];

    return windowMatch.length > 0 ? { goalTransactionCode: windowMatch[0].goalTransactionCode } : null;
  }

  /**
   * Find a matching bank transaction
   */
  private static async findMatchingBankTransaction(
    goalNumber: string,
    transactionId: string | null,
    transactionType: string,
    amount: number,
    transactionDate: Date
  ): Promise<{ transactionId: string } | null> {
    const tolerance = Math.max(Math.abs(amount) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
    const minDate = new Date(transactionDate);
    minDate.setDate(minDate.getDate() - DATE_WINDOW_DAYS);
    const maxDate = new Date(transactionDate);
    maxDate.setDate(maxDate.getDate() + DATE_WINDOW_DAYS);

    // Convert to strings for proper PostgreSQL binding
    const amountStr = String(amount);
    const toleranceStr = String(tolerance);

    // First try exact transactionId match
    if (transactionId) {
      const exactMatch = await prisma.$queryRawUnsafe(`
        SELECT b."transactionId", b."totalAmount"
        FROM bank_goal_transactions b
        WHERE b."goalNumber" = $1
          AND b."transactionId" = $2
          AND b."transactionType"::text = $3
          AND ABS(b."totalAmount" - $4::numeric) <= $5::numeric
        LIMIT 1
      `, goalNumber, transactionId, transactionType, amountStr, toleranceStr) as any[];

      if (exactMatch.length > 0) {
        return { transactionId: exactMatch[0].transactionId };
      }
    }

    // Fall back to amount + date window match
    const windowMatch = await prisma.$queryRawUnsafe(`
      SELECT b."transactionId", b."totalAmount"
      FROM bank_goal_transactions b
      WHERE b."goalNumber" = $1
        AND b."transactionType"::text = $2
        AND b."transactionDate" >= $3
        AND b."transactionDate" <= $4
        AND ABS(b."totalAmount" - $5::numeric) <= $6::numeric
      LIMIT 1
    `, goalNumber, transactionType, minDate, maxDate, amountStr, toleranceStr) as any[];

    return windowMatch.length > 0 ? { transactionId: windowMatch[0].transactionId } : null;
  }

  /**
   * Find a goal transaction within timing tolerance (±3 days) with exact transactionId match
   */
  private static async findGoalTransactionWithinTimingTolerance(
    goalNumber: string,
    transactionId: string | null,
    transactionType: string,
    amount: number,
    transactionDate: Date
  ): Promise<{ transactionDate: string } | null> {
    if (!transactionId) return null;

    const tolerance = Math.max(Math.abs(amount) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
    const minDate = new Date(transactionDate);
    minDate.setDate(minDate.getDate() - TIMING_TOLERANCE_DAYS);
    const maxDate = new Date(transactionDate);
    maxDate.setDate(maxDate.getDate() + TIMING_TOLERANCE_DAYS);

    // Convert to strings for proper PostgreSQL binding
    const amountStr = String(amount);
    const toleranceStr = String(tolerance);

    const match = await prisma.$queryRawUnsafe(`
      SELECT MIN(f."transactionDate")::date as transaction_date, SUM(f."amount") as total
      FROM fund_transactions f
      JOIN goals g ON f."goalId" = g.id
      WHERE g."goalNumber" = $1
        AND f."transactionId" = $2
        AND f."transactionType"::text = $3
        AND f."transactionDate" >= $4
        AND f."transactionDate" <= $5
      GROUP BY f."goalTransactionCode"
      HAVING ABS(SUM(f."amount") - $6::numeric) <= $7::numeric
      LIMIT 1
    `, goalNumber, transactionId, transactionType, minDate, maxDate, amountStr, toleranceStr) as any[];

    return match.length > 0 ? { transactionDate: match[0].transaction_date.toISOString().split('T')[0] } : null;
  }

  /**
   * Find a bank transaction within timing tolerance (±3 days) with exact transactionId match
   */
  private static async findBankTransactionWithinTimingTolerance(
    goalNumber: string,
    transactionId: string | null,
    transactionType: string,
    amount: number,
    transactionDate: Date
  ): Promise<{ transactionDate: string } | null> {
    if (!transactionId) return null;

    const tolerance = Math.max(Math.abs(amount) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
    const minDate = new Date(transactionDate);
    minDate.setDate(minDate.getDate() - TIMING_TOLERANCE_DAYS);
    const maxDate = new Date(transactionDate);
    maxDate.setDate(maxDate.getDate() + TIMING_TOLERANCE_DAYS);

    // Convert to strings for proper PostgreSQL binding
    const amountStr = String(amount);
    const toleranceStr = String(tolerance);

    const match = await prisma.$queryRawUnsafe(`
      SELECT b."transactionDate"::date as transaction_date
      FROM bank_goal_transactions b
      WHERE b."goalNumber" = $1
        AND b."transactionId" = $2
        AND b."transactionType"::text = $3
        AND b."transactionDate" >= $4
        AND b."transactionDate" <= $5
        AND ABS(b."totalAmount" - $6::numeric) <= $7::numeric
      LIMIT 1
    `, goalNumber, transactionId, transactionType, minDate, maxDate, amountStr, toleranceStr) as any[];

    return match.length > 0 ? { transactionDate: match[0].transaction_date.toISOString().split('T')[0] } : null;
  }

  /**
   * Mark detected resolutions in the database
   */
  private static async markAsResolved(
    results: ResolutionResult[],
    batchId: string | null
  ): Promise<void> {
    const now = new Date();

    // Group by source type
    const bankResolutions = results.filter(r => r.source === 'BANK');
    const goalResolutions = results.filter(r => r.source === 'GOAL');

    // Update bank transactions
    for (const resolution of bankResolutions) {
      await prisma.bankGoalTransaction.update({
        where: { id: resolution.id },
        data: {
          varianceResolved: true,
          resolvedAt: now,
          resolvedReason: resolution.resolvedReason,
          resolvedByBatchId: batchId,
        },
      });
    }

    // Update goal transactions (fund transactions by goalTransactionCode)
    for (const resolution of goalResolutions) {
      await prisma.fundTransaction.updateMany({
        where: { goalTransactionCode: resolution.id },
        data: {
          varianceResolved: true,
          resolvedAt: now,
          resolvedReason: resolution.resolvedReason,
          resolvedByBatchId: batchId,
        },
      });
    }

    logger.info('Marked variances as resolved', {
      bankCount: bankResolutions.length,
      goalCount: goalResolutions.length,
      batchId,
    });

    // Verify the updates took effect
    const bankResolvedCount = await prisma.bankGoalTransaction.count({
      where: { varianceResolved: true }
    });
    const goalResolvedCount = await prisma.fundTransaction.count({
      where: { varianceResolved: true }
    });
    logger.info('Verification - total resolved in database', {
      bankResolvedCount,
      goalResolvedCount,
    });
  }

  /**
   * Get a report of resolved variances
   */
  static async getResolvedVariancesReport(
    dateRange?: { startDate: string; endDate: string },
    filters?: {
      goalNumber?: string;
      clientSearch?: string;
      originalTag?: string;
    }
  ): Promise<{
    data: any[];
    summary: {
      totalResolved: number;
      byTag: Record<string, number>;
      bySource: { bank: number; goal: number };
    };
  }> {
    // First check how many resolved records exist in database
    const bankResolvedCount = await prisma.bankGoalTransaction.count({
      where: { varianceResolved: true }
    });
    const goalResolvedCount = await prisma.fundTransaction.count({
      where: { varianceResolved: true }
    });
    logger.info('getResolvedVariancesReport - database check', {
      bankResolvedCount,
      goalResolvedCount,
      dateRange,
      filters,
    });

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (dateRange) {
      // Filter by transaction_date, not resolved_at (user's date range is for transactions)
      conditions.push(`transaction_date::date >= $${paramIndex}::date AND transaction_date::date <= $${paramIndex + 1}::date`);
      params.push(dateRange.startDate, dateRange.endDate);
      paramIndex += 2;
    }

    if (filters?.goalNumber) {
      conditions.push(`goal_number ILIKE $${paramIndex}`);
      params.push(`%${filters.goalNumber}%`);
      paramIndex++;
    }

    if (filters?.clientSearch) {
      conditions.push(`client_name ILIKE $${paramIndex}`);
      params.push(`%${filters.clientSearch}%`);
      paramIndex++;
    }

    if (filters?.originalTag) {
      conditions.push(`original_tag = $${paramIndex}`);
      params.push(filters.originalTag);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      WITH resolved_bank AS (
        SELECT
          'BANK' as source,
          b.id,
          b."goalNumber" as goal_number,
          c."clientName" as client_name,
          a."accountNumber" as account_number,
          b."transactionDate" as transaction_date,
          b."transactionType" as transaction_type,
          b."totalAmount" as amount,
          b."transactionId" as source_transaction_id,
          b."reviewTag"::text as original_tag,
          b."reviewNotes" as review_notes,
          b."resolvedAt" as resolved_at,
          b."resolvedReason" as resolved_reason,
          b."resolvedByBatchId" as resolved_by_batch_id
        FROM bank_goal_transactions b
        JOIN clients c ON b."clientId" = c.id
        JOIN accounts a ON b."accountId" = a.id
        WHERE b."varianceResolved" = true
      ),
      resolved_goal AS (
        SELECT
          'GOAL' as source,
          f."goalTransactionCode" as id,
          g."goalNumber" as goal_number,
          c."clientName" as client_name,
          a."accountNumber" as account_number,
          MIN(f."transactionDate") as transaction_date,
          f."transactionType" as transaction_type,
          SUM(f."amount") as amount,
          f."transactionId" as source_transaction_id,
          MAX(f."reviewTag"::text) as original_tag,
          MAX(f."reviewNotes") as review_notes,
          MAX(f."resolvedAt") as resolved_at,
          MAX(f."resolvedReason") as resolved_reason,
          MAX(f."resolvedByBatchId") as resolved_by_batch_id
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g.id
        JOIN accounts a ON g."accountId" = a.id
        JOIN clients c ON a."clientId" = c.id
        WHERE f."varianceResolved" = true
        GROUP BY f."goalTransactionCode", g."goalNumber", c."clientName", a."accountNumber",
                 f."transactionType", f."transactionId"
      )
      SELECT * FROM (
        SELECT * FROM resolved_bank
        UNION ALL
        SELECT * FROM resolved_goal
      ) combined
      ${whereClause}
      ORDER BY resolved_at DESC, goal_number
    `;

    logger.info('Resolved variances report query', {
      whereClause,
      params,
      dateRange,
      filters,
    });

    const results = await prisma.$queryRawUnsafe(query, ...params) as any[];

    logger.info('Resolved variances report results', {
      resultCount: results.length,
    });

    // Calculate summary
    const byTag: Record<string, number> = {};
    let bankCount = 0;
    let goalCount = 0;

    for (const r of results) {
      if (r.original_tag) {
        byTag[r.original_tag] = (byTag[r.original_tag] || 0) + 1;
      }
      if (r.source === 'BANK') bankCount++;
      else goalCount++;
    }

    return {
      data: results.map(r => ({
        source: r.source,
        id: r.id,
        goalNumber: r.goal_number,
        clientName: r.client_name,
        accountNumber: r.account_number,
        transactionDate: r.transaction_date,
        transactionType: r.transaction_type,
        amount: Number(r.amount),
        sourceTransactionId: r.source_transaction_id,
        originalTag: r.original_tag,
        reviewNotes: r.review_notes,
        resolvedAt: r.resolved_at,
        resolvedReason: r.resolved_reason,
        resolvedByBatchId: r.resolved_by_batch_id,
      })),
      summary: {
        totalResolved: results.length,
        byTag,
        bySource: { bank: bankCount, goal: goalCount },
      },
    };
  }

  /**
   * Manually trigger resolution detection for specific goals
   */
  static async detectForGoals(
    goalNumbers: string[],
    triggeredBy: string
  ): Promise<DetectionResult> {
    logger.info('Manual variance resolution detection triggered', {
      goalNumbers,
      triggeredBy,
    });

    // For now, run full detection - could be optimized later
    return this.detectResolvedVariances(undefined, undefined);
  }

  /**
   * Get resolution statistics
   */
  static async getResolutionStats(): Promise<{
    totalTaggedForResolution: number;
    totalResolved: number;
    pendingResolution: number;
    byTag: Record<string, { total: number; resolved: number; pending: number }>;
  }> {
    const query = `
      WITH bank_stats AS (
        SELECT
          "reviewTag"::text as tag,
          COUNT(*) as total,
          SUM(CASE WHEN "varianceResolved" = true THEN 1 ELSE 0 END) as resolved
        FROM bank_goal_transactions
        WHERE "reviewTag" IN ('MISSING_IN_GOAL', 'MISSING_IN_BANK', 'TIMING_DIFFERENCE')
        GROUP BY "reviewTag"
      ),
      goal_stats AS (
        SELECT
          f."reviewTag"::text as tag,
          COUNT(DISTINCT f."goalTransactionCode") as total,
          SUM(CASE WHEN f."varianceResolved" = true THEN 1 ELSE 0 END) as resolved
        FROM fund_transactions f
        WHERE f."reviewTag" IN ('MISSING_IN_GOAL', 'MISSING_IN_BANK', 'TIMING_DIFFERENCE')
        GROUP BY f."reviewTag"
      )
      SELECT
        COALESCE(b.tag, g.tag) as tag,
        COALESCE(b.total, 0) + COALESCE(g.total, 0) as total,
        COALESCE(b.resolved, 0) + COALESCE(g.resolved, 0) as resolved
      FROM bank_stats b
      FULL OUTER JOIN goal_stats g ON b.tag = g.tag
    `;

    const results = await prisma.$queryRawUnsafe(query) as any[];

    const byTag: Record<string, { total: number; resolved: number; pending: number }> = {};
    let totalTagged = 0;
    let totalResolved = 0;

    for (const r of results) {
      const total = Number(r.total);
      const resolved = Number(r.resolved);
      byTag[r.tag] = {
        total,
        resolved,
        pending: total - resolved,
      };
      totalTagged += total;
      totalResolved += resolved;
    }

    return {
      totalTaggedForResolution: totalTagged,
      totalResolved,
      pendingResolution: totalTagged - totalResolved,
      byTag,
    };
  }
}

export default VarianceResolutionService;
