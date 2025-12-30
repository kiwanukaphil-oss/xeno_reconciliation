import { PrismaClient, ReconciliationStatus, Prisma } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

// Tolerance settings
const AMOUNT_TOLERANCE_PERCENT = 0.01; // 1%
const AMOUNT_TOLERANCE_MIN = 1000; // 1000 UGX minimum
const DATE_WINDOW_DAYS = 30;

interface MatchResult {
  bankIds: string[];
  fundIds: string[];
  matchType: 'EXACT' | 'AMOUNT' | 'SPLIT_BANK_TO_FUND' | 'SPLIT_FUND_TO_BANK' | 'MANUAL';
  confidence: number;
  bankTotal: number;
  fundTotal: number;
}

interface GoalSummary {
  goalNumber: string;
  clientName: string;
  accountNumber: string;
  bankDeposits: number;
  goalTxnDeposits: number;
  depositVariance: number;
  depositBankCount: number;
  depositGoalTxnCount: number;
  bankWithdrawals: number;
  goalTxnWithdrawals: number;
  withdrawalVariance: number;
  withdrawalBankCount: number;
  withdrawalGoalTxnCount: number;
  // Primary status based on amount comparison (independent of Smart Matching)
  status: 'MATCHED' | 'VARIANCE';
  hasVariance: boolean;
  // Review status for variance goals (based on tagged transactions, independent of Smart Matching)
  reviewStatus: 'NOT_APPLICABLE' | 'UNREVIEWED' | 'PARTIALLY_REVIEWED' | 'REVIEWED';
  unreviewedCount: number;
  reviewedCount: number;
}

interface GoalTransaction {
  goalTransactionCode: string;
  transactionDate: Date;
  transactionId: string | null;
  transactionType: string;
  totalAmount: number;
  xummfAmount: number;
  xubfAmount: number;
  xudefAmount: number;
  xurefAmount: number;
  fundTransactionIds: string[];
  // Review fields
  reviewTag: string | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

interface FundSummary {
  goalNumber: string;
  clientName: string;
  accountNumber: string;
  // Bank fund totals (NET)
  bankXUMMF: number;
  bankXUBF: number;
  bankXUDEF: number;
  bankXUREF: number;
  bankTotal: number;
  // Goal transaction fund totals (NET)
  goalXUMMF: number;
  goalXUBF: number;
  goalXUDEF: number;
  goalXUREF: number;
  goalTotal: number;
  // Variances
  xummfVariance: number;
  xubfVariance: number;
  xudefVariance: number;
  xurefVariance: number;
  totalVariance: number;
  // Status
  status: 'MATCHED' | 'VARIANCE' | 'REVIEWED';
}

interface AccountFundSummary {
  accountNumber: string;
  clientName: string;
  goalCount: number;
  // Bank fund totals (NET)
  bankXUMMF: number;
  bankXUBF: number;
  bankXUDEF: number;
  bankXUREF: number;
  bankTotal: number;
  // Goal transaction fund totals (NET)
  goalXUMMF: number;
  goalXUBF: number;
  goalXUDEF: number;
  goalXUREF: number;
  goalTotal: number;
  // Variances
  xummfVariance: number;
  xubfVariance: number;
  xudefVariance: number;
  xurefVariance: number;
  totalVariance: number;
  // Status
  status: 'MATCHED' | 'VARIANCE';
  matchedGoalCount: number;
  varianceGoalCount: number;
}

/**
 * Smart Matching Algorithm for Bank/Fund Reconciliation
 *
 * Three-pass matching approach:
 * 1. EXACT MATCH: Match by goalNumber + transactionId
 * 2. AMOUNT MATCH: Match by amount within ±30 day window
 * 3. SPLIT DETECTION: Find combinations that sum to matching amounts
 */
export class SmartMatcher {

  /**
   * Get goal-level summary for a date range
   * @param startDate - Start date as YYYY-MM-DD string to avoid timezone issues
   * @param endDate - End date as YYYY-MM-DD string to avoid timezone issues
   */
  static async getGoalSummary(
    startDate: string,
    endDate: string,
    filters?: {
      goalNumber?: string;
      accountNumber?: string;
      clientSearch?: string;
      status?: 'ALL' | 'MATCHED' | 'VARIANCE' | 'REVIEWED' | 'UNREVIEWED' | 'PARTIAL';
    }
  ): Promise<{ data: GoalSummary[]; total: number }> {
    const conditions: string[] = [];
    // Pass date strings directly to avoid timezone conversion issues
    const params: any[] = [startDate, endDate];
    let paramIndex = 3;

    // Build optional filters
    if (filters?.goalNumber) {
      conditions.push(`g."goalNumber" ILIKE $${paramIndex}`);
      params.push(`%${filters.goalNumber}%`);
      paramIndex++;
    }

    if (filters?.accountNumber) {
      conditions.push(`a."accountNumber" ILIKE $${paramIndex}`);
      params.push(`%${filters.accountNumber}%`);
      paramIndex++;
    }

    if (filters?.clientSearch) {
      conditions.push(`c."clientName" ILIKE $${paramIndex}`);
      params.push(`%${filters.clientSearch}%`);
      paramIndex++;
    }

    const filterClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    // Query to aggregate bank and goal transactions by goal and type
    // Goal transactions are aggregated from fund_transactions grouped by goalTransactionCode
    // Use ::date cast to ensure proper date comparison without timezone issues
    //
    // Review status logic (SIMPLE transactionId matching):
    // - "Unmatched" = bank/goal transactions where transactionId doesn't match
    // - Pending = unmatched with no reviewTag
    // - When ALL unmatched transactions have reviewTag → REVIEWED
    // - No need to run Smart Matching - works immediately based on transactionId
    const query = `
      WITH bank_summary AS (
        SELECT
          b."goalNumber",
          b."transactionType",
          SUM(b."totalAmount") as total_amount,
          COUNT(*) as txn_count
        FROM bank_goal_transactions b
        WHERE b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date
          AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
        GROUP BY b."goalNumber", b."transactionType"
      ),
      goal_txn_summary AS (
        SELECT
          g."goalNumber",
          f."transactionType",
          SUM(f."amount") as total_amount,
          COUNT(DISTINCT f."goalTransactionCode") as txn_count
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g."id"
        WHERE f."transactionDate"::date >= $1::date AND f."transactionDate"::date <= $2::date
          AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
        GROUP BY g."goalNumber", f."transactionType"
      ),
      -- Count bank transactions not matched by transactionId (variance transactions)
      -- These are split into: unreviewed (pending) vs reviewed (tagged OR Smart Matched)
      unmatched_bank_stats AS (
        SELECT
          b."goalNumber",
          -- Unreviewed/Pending = not tagged AND not matched by Smart Matcher
          COUNT(*) FILTER (WHERE b."reviewTag" IS NULL AND b."matchedGoalTransactionCode" IS NULL) as unreviewed_count,
          -- Reviewed = tagged OR matched by Smart Matcher
          COUNT(*) FILTER (WHERE b."reviewTag" IS NOT NULL OR b."matchedGoalTransactionCode" IS NOT NULL) as reviewed_count
        FROM bank_goal_transactions b
        WHERE b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date
          AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
          -- Only include transactions NOT matched by transactionId (these are the variance/unmatched ones)
          AND NOT EXISTS (
            SELECT 1 FROM fund_transactions f
            JOIN goals g ON f."goalId" = g."id"
            WHERE g."goalNumber" = b."goalNumber"
              AND f."transactionId" = b."transactionId"
              AND f."transactionType" = b."transactionType"
              AND f."transactionDate"::date >= $1::date AND f."transactionDate"::date <= $2::date
              AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
          )
        GROUP BY b."goalNumber"
      ),
      -- Count goal transactions not matched by transactionId (variance transactions)
      -- These are split into: unreviewed (pending) vs reviewed (tagged OR referenced by Smart Match)
      unmatched_goal_stats AS (
        SELECT
          g."goalNumber",
          -- Unreviewed/Pending = not tagged AND not referenced by any bank's matchedGoalTransactionCode
          COUNT(DISTINCT f."goalTransactionCode") FILTER (
            WHERE f."reviewTag" IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM bank_goal_transactions b2
                WHERE b2."goalNumber" = g."goalNumber"
                  AND b2."matchedGoalTransactionCode" IS NOT NULL
                  AND (
                    b2."matchedGoalTransactionCode" = f."goalTransactionCode"
                    OR f."goalTransactionCode" = ANY(string_to_array(
                      CASE
                        WHEN b2."matchedGoalTransactionCode" LIKE 'MANUAL:%' THEN split_part(b2."matchedGoalTransactionCode", ':', 3)
                        WHEN b2."matchedGoalTransactionCode" LIKE '%:%' THEN split_part(b2."matchedGoalTransactionCode", ':', 2)
                        ELSE b2."matchedGoalTransactionCode"
                      END,
                      ','
                    ))
                  )
              )
          ) as unreviewed_count,
          -- Reviewed = tagged OR referenced by a bank's matchedGoalTransactionCode
          COUNT(DISTINCT f."goalTransactionCode") FILTER (
            WHERE f."reviewTag" IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM bank_goal_transactions b2
                WHERE b2."goalNumber" = g."goalNumber"
                  AND b2."matchedGoalTransactionCode" IS NOT NULL
                  AND (
                    b2."matchedGoalTransactionCode" = f."goalTransactionCode"
                    OR f."goalTransactionCode" = ANY(string_to_array(
                      CASE
                        WHEN b2."matchedGoalTransactionCode" LIKE 'MANUAL:%' THEN split_part(b2."matchedGoalTransactionCode", ':', 3)
                        WHEN b2."matchedGoalTransactionCode" LIKE '%:%' THEN split_part(b2."matchedGoalTransactionCode", ':', 2)
                        ELSE b2."matchedGoalTransactionCode"
                      END,
                      ','
                    ))
                  )
              )
          ) as reviewed_count
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g."id"
        WHERE f."transactionDate"::date >= $1::date AND f."transactionDate"::date <= $2::date
          AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
          -- Only include transactions NOT matched by transactionId (these are the variance/unmatched ones)
          AND NOT EXISTS (
            SELECT 1 FROM bank_goal_transactions b
            WHERE b."goalNumber" = g."goalNumber"
              AND b."transactionId" = f."transactionId"
              AND b."transactionType" = f."transactionType"
              AND b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date
              AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
          )
        GROUP BY g."goalNumber"
      ),
      goal_info AS (
        SELECT DISTINCT
          g."goalNumber",
          c."clientName",
          a."accountNumber"
        FROM goals g
        JOIN accounts a ON g."accountId" = a."id"
        JOIN clients c ON a."clientId" = c."id"
        WHERE 1=1 ${filterClause}
      )
      SELECT
        gi."goalNumber",
        gi."clientName",
        gi."accountNumber",
        COALESCE(bd.total_amount, 0)::float as "bankDeposits",
        COALESCE(gtd.total_amount, 0)::float as "goalTxnDeposits",
        COALESCE(bd.txn_count, 0)::int as "depositBankCount",
        COALESCE(gtd.txn_count, 0)::int as "depositGoalTxnCount",
        COALESCE(bw.total_amount, 0)::float as "bankWithdrawals",
        COALESCE(gtw.total_amount, 0)::float as "goalTxnWithdrawals",
        COALESCE(bw.txn_count, 0)::int as "withdrawalBankCount",
        COALESCE(gtw.txn_count, 0)::int as "withdrawalGoalTxnCount",
        COALESCE(ubs.unreviewed_count, 0)::int + COALESCE(ugs.unreviewed_count, 0)::int as "unreviewedCount",
        COALESCE(ubs.reviewed_count, 0)::int + COALESCE(ugs.reviewed_count, 0)::int as "reviewedCount"
      FROM goal_info gi
      LEFT JOIN bank_summary bd ON bd."goalNumber" = gi."goalNumber" AND bd."transactionType" = 'DEPOSIT'
      LEFT JOIN bank_summary bw ON bw."goalNumber" = gi."goalNumber" AND bw."transactionType" = 'WITHDRAWAL'
      LEFT JOIN goal_txn_summary gtd ON gtd."goalNumber" = gi."goalNumber" AND gtd."transactionType" = 'DEPOSIT'
      LEFT JOIN goal_txn_summary gtw ON gtw."goalNumber" = gi."goalNumber" AND gtw."transactionType" = 'WITHDRAWAL'
      LEFT JOIN unmatched_bank_stats ubs ON ubs."goalNumber" = gi."goalNumber"
      LEFT JOIN unmatched_goal_stats ugs ON ugs."goalNumber" = gi."goalNumber"
      WHERE (bd.total_amount IS NOT NULL OR bw.total_amount IS NOT NULL
             OR gtd.total_amount IS NOT NULL OR gtw.total_amount IS NOT NULL)
      ORDER BY gi."goalNumber"
    `;

    const rawResults = await prisma.$queryRawUnsafe(query, ...params) as any[];

    // Process results and add calculated fields
    const results: GoalSummary[] = rawResults.map(row => {
      const depositVariance = row.bankDeposits - row.goalTxnDeposits;
      const withdrawalVariance = row.bankWithdrawals - row.goalTxnWithdrawals;

      // Determine tolerance for each type
      const depositTolerance = Math.max(row.goalTxnDeposits * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
      const withdrawalTolerance = Math.max(row.goalTxnWithdrawals * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);

      const hasDepositVariance = Math.abs(depositVariance) > depositTolerance;
      const hasWithdrawalVariance = Math.abs(withdrawalVariance) > withdrawalTolerance;
      const hasVariance = hasDepositVariance || hasWithdrawalVariance;

      // Primary status: MATCHED or VARIANCE based purely on amount comparison
      const status: 'MATCHED' | 'VARIANCE' = hasVariance ? 'VARIANCE' : 'MATCHED';

      // Review status: For variance goals, track review progress (independent of Smart Matching)
      // - NOT_APPLICABLE: Goal has no variance, no review needed
      // - UNREVIEWED: Has unmatched transactions, none tagged yet
      // - PARTIALLY_REVIEWED: Some unmatched transactions tagged, some not
      // - REVIEWED: All unmatched transactions have been tagged
      const unreviewedCount = row.unreviewedCount;
      const reviewedCount = row.reviewedCount;
      const totalUnmatched = unreviewedCount + reviewedCount;

      let reviewStatus: 'NOT_APPLICABLE' | 'UNREVIEWED' | 'PARTIALLY_REVIEWED' | 'REVIEWED';
      if (!hasVariance) {
        reviewStatus = 'NOT_APPLICABLE';
      } else if (totalUnmatched === 0) {
        // Goal has variance but no unmatched transactions (edge case - amounts differ but all txns match by ID)
        reviewStatus = 'NOT_APPLICABLE';
      } else if (unreviewedCount === 0) {
        reviewStatus = 'REVIEWED';
      } else if (reviewedCount > 0) {
        reviewStatus = 'PARTIALLY_REVIEWED';
      } else {
        reviewStatus = 'UNREVIEWED';
      }

      return {
        goalNumber: row.goalNumber,
        clientName: row.clientName,
        accountNumber: row.accountNumber,
        bankDeposits: row.bankDeposits,
        goalTxnDeposits: row.goalTxnDeposits,
        depositVariance,
        depositBankCount: row.depositBankCount,
        depositGoalTxnCount: row.depositGoalTxnCount,
        bankWithdrawals: row.bankWithdrawals,
        goalTxnWithdrawals: row.goalTxnWithdrawals,
        withdrawalVariance,
        withdrawalBankCount: row.withdrawalBankCount,
        withdrawalGoalTxnCount: row.withdrawalGoalTxnCount,
        status,
        hasVariance,
        reviewStatus,
        unreviewedCount,
        reviewedCount,
      };
    });

    // Apply status filter if specified
    // Filter options:
    // - ALL: Show all goals
    // - MATCHED: Show only matched goals (no variance)
    // - VARIANCE: Show only variance goals (regardless of review status)
    // - REVIEWED: Show variance goals that have been fully reviewed
    // - UNREVIEWED: Show variance goals that have NO reviewed transactions (all pending)
    // - PARTIAL: Show variance goals that are partially reviewed (some pending, some reviewed)
    let filteredResults = results;
    if (filters?.status && filters.status !== 'ALL') {
      switch (filters.status) {
        case 'REVIEWED':
          // Show variance goals that are fully reviewed (no pending)
          filteredResults = results.filter(r => r.status === 'VARIANCE' && r.reviewStatus === 'REVIEWED');
          break;
        case 'UNREVIEWED':
          // Show variance goals with pending transactions (NOT fully reviewed)
          // This includes both UNREVIEWED and PARTIALLY_REVIEWED
          filteredResults = results.filter(r =>
            r.status === 'VARIANCE' &&
            (r.reviewStatus === 'UNREVIEWED' || r.reviewStatus === 'PARTIALLY_REVIEWED')
          );
          break;
        case 'PARTIAL':
          // Show variance goals that are partially reviewed
          filteredResults = results.filter(r => r.status === 'VARIANCE' && r.reviewStatus === 'PARTIALLY_REVIEWED');
          break;
        case 'MATCHED':
        case 'VARIANCE':
          filteredResults = results.filter(r => r.status === filters.status);
          break;
      }
    }

    return {
      data: filteredResults,
      total: filteredResults.length,
    };
  }

  /**
   * Get fund-level summary for a date range
   * Compares per-fund NET amounts (XUMMF, XUBF, XUDEF, XUREF) between bank and goal transactions
   * @param startDate - Start date as YYYY-MM-DD string to avoid timezone issues
   * @param endDate - End date as YYYY-MM-DD string to avoid timezone issues
   */
  static async getFundSummary(
    startDate: string,
    endDate: string,
    filters?: {
      goalNumber?: string;
      accountNumber?: string;
      clientSearch?: string;
      status?: 'ALL' | 'MATCHED' | 'VARIANCE' | 'REVIEWED';
    }
  ): Promise<{ data: FundSummary[]; total: number }> {
    const conditions: string[] = [];
    // Pass date strings directly to avoid timezone conversion issues
    const params: any[] = [startDate, endDate];
    let paramIndex = 3;

    // Build optional filters
    if (filters?.goalNumber) {
      conditions.push(`g."goalNumber" ILIKE $${paramIndex}`);
      params.push(`%${filters.goalNumber}%`);
      paramIndex++;
    }

    if (filters?.accountNumber) {
      conditions.push(`a."accountNumber" ILIKE $${paramIndex}`);
      params.push(`%${filters.accountNumber}%`);
      paramIndex++;
    }

    if (filters?.clientSearch) {
      conditions.push(`c."clientName" ILIKE $${paramIndex}`);
      params.push(`%${filters.clientSearch}%`);
      paramIndex++;
    }

    const filterClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    // Query to aggregate bank and goal transactions by fund (NET amounts)
    // Use ::date cast to ensure proper date comparison without timezone issues
    const query = `
      WITH bank_fund_summary AS (
        SELECT
          b."goalNumber",
          SUM(b."xummfAmount") as xummf,
          SUM(b."xubfAmount") as xubf,
          SUM(b."xudefAmount") as xudef,
          SUM(b."xurefAmount") as xuref,
          SUM(b."totalAmount") as total
        FROM bank_goal_transactions b
        WHERE b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date
          AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
        GROUP BY b."goalNumber"
      ),
      goal_fund_summary AS (
        SELECT
          g."goalNumber",
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUMMF') as xummf,
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUBF') as xubf,
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUDEF') as xudef,
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUREF') as xuref,
          SUM(f."amount") as total
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g."id"
        JOIN funds fund ON f."fundId" = fund."id"
        WHERE f."transactionDate"::date >= $1::date AND f."transactionDate"::date <= $2::date
          AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
        GROUP BY g."goalNumber"
      ),
      goal_info AS (
        SELECT DISTINCT
          g."goalNumber",
          c."clientName",
          a."accountNumber"
        FROM goals g
        JOIN accounts a ON g."accountId" = a."id"
        JOIN clients c ON a."clientId" = c."id"
        WHERE 1=1 ${filterClause}
      )
      SELECT
        gi."goalNumber",
        gi."clientName",
        gi."accountNumber",
        COALESCE(bfs.xummf, 0)::float as "bankXUMMF",
        COALESCE(bfs.xubf, 0)::float as "bankXUBF",
        COALESCE(bfs.xudef, 0)::float as "bankXUDEF",
        COALESCE(bfs.xuref, 0)::float as "bankXUREF",
        COALESCE(bfs.total, 0)::float as "bankTotal",
        COALESCE(gfs.xummf, 0)::float as "goalXUMMF",
        COALESCE(gfs.xubf, 0)::float as "goalXUBF",
        COALESCE(gfs.xudef, 0)::float as "goalXUDEF",
        COALESCE(gfs.xuref, 0)::float as "goalXUREF",
        COALESCE(gfs.total, 0)::float as "goalTotal"
      FROM goal_info gi
      LEFT JOIN bank_fund_summary bfs ON bfs."goalNumber" = gi."goalNumber"
      LEFT JOIN goal_fund_summary gfs ON gfs."goalNumber" = gi."goalNumber"
      WHERE (bfs.total IS NOT NULL OR gfs.total IS NOT NULL)
      ORDER BY gi."goalNumber"
    `;

    const rawResults = await prisma.$queryRawUnsafe(query, ...params) as any[];

    // Process results and add calculated fields
    const results: FundSummary[] = rawResults.map(row => {
      const xummfVariance = row.bankXUMMF - row.goalXUMMF;
      const xubfVariance = row.bankXUBF - row.goalXUBF;
      const xudefVariance = row.bankXUDEF - row.goalXUDEF;
      const xurefVariance = row.bankXUREF - row.goalXUREF;
      const totalVariance = row.bankTotal - row.goalTotal;

      // Check if any fund has a variance beyond tolerance
      const checkVariance = (goalAmount: number, variance: number): boolean => {
        const tolerance = Math.max(Math.abs(goalAmount) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
        return Math.abs(variance) > tolerance;
      };

      const hasXUMMFVariance = checkVariance(row.goalXUMMF, xummfVariance);
      const hasXUBFVariance = checkVariance(row.goalXUBF, xubfVariance);
      const hasXUDEFVariance = checkVariance(row.goalXUDEF, xudefVariance);
      const hasXUREFVariance = checkVariance(row.goalXUREF, xurefVariance);
      const hasAnyVariance = hasXUMMFVariance || hasXUBFVariance || hasXUDEFVariance || hasXUREFVariance;

      return {
        goalNumber: row.goalNumber,
        clientName: row.clientName,
        accountNumber: row.accountNumber,
        bankXUMMF: row.bankXUMMF,
        bankXUBF: row.bankXUBF,
        bankXUDEF: row.bankXUDEF,
        bankXUREF: row.bankXUREF,
        bankTotal: row.bankTotal,
        goalXUMMF: row.goalXUMMF,
        goalXUBF: row.goalXUBF,
        goalXUDEF: row.goalXUDEF,
        goalXUREF: row.goalXUREF,
        goalTotal: row.goalTotal,
        xummfVariance,
        xubfVariance,
        xudefVariance,
        xurefVariance,
        totalVariance,
        status: hasAnyVariance ? 'VARIANCE' : 'MATCHED',
      };
    });

    // Apply status filter if specified
    let filteredResults = results;
    if (filters?.status && filters.status !== 'ALL') {
      filteredResults = results.filter(r => r.status === filters.status);
    }

    return {
      data: filteredResults,
      total: filteredResults.length,
    };
  }

  /**
   * Get account-level fund summary aggregating all goals within each account
   * @param startDate - Start date as YYYY-MM-DD string
   * @param endDate - End date as YYYY-MM-DD string
   * @param filters - Optional filters for accountNumber, clientSearch, status
   */
  static async getAccountFundSummary(
    startDate: string,
    endDate: string,
    filters?: {
      accountNumber?: string;
      clientSearch?: string;
      status?: 'ALL' | 'MATCHED' | 'VARIANCE';
    }
  ): Promise<{ data: AccountFundSummary[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [startDate, endDate];
    let paramIndex = 3;

    // Build optional filters
    if (filters?.accountNumber) {
      conditions.push(`a."accountNumber" ILIKE $${paramIndex}`);
      params.push(`%${filters.accountNumber}%`);
      paramIndex++;
    }

    if (filters?.clientSearch) {
      conditions.push(`c."clientName" ILIKE $${paramIndex}`);
      params.push(`%${filters.clientSearch}%`);
      paramIndex++;
    }

    const filterClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    // Query to aggregate bank and goal transactions by ACCOUNT (summing all goals)
    const query = `
      WITH bank_fund_summary AS (
        SELECT
          b."goalNumber",
          SUM(b."xummfAmount") as xummf,
          SUM(b."xubfAmount") as xubf,
          SUM(b."xudefAmount") as xudef,
          SUM(b."xurefAmount") as xuref,
          SUM(b."totalAmount") as total
        FROM bank_goal_transactions b
        WHERE b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date
          AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
        GROUP BY b."goalNumber"
      ),
      goal_fund_summary AS (
        SELECT
          g."goalNumber",
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUMMF') as xummf,
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUBF') as xubf,
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUDEF') as xudef,
          SUM(f."amount") FILTER (WHERE fund."fundCode" = 'XUREF') as xuref,
          SUM(f."amount") as total
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g."id"
        JOIN funds fund ON f."fundId" = fund."id"
        WHERE f."transactionDate"::date >= $1::date AND f."transactionDate"::date <= $2::date
          AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
        GROUP BY g."goalNumber"
      ),
      goal_info AS (
        SELECT DISTINCT
          g."goalNumber",
          c."clientName",
          a."accountNumber"
        FROM goals g
        JOIN accounts a ON g."accountId" = a."id"
        JOIN clients c ON a."clientId" = c."id"
        WHERE 1=1 ${filterClause}
      ),
      goal_level AS (
        SELECT
          gi."goalNumber",
          gi."clientName",
          gi."accountNumber",
          COALESCE(bfs.xummf, 0)::float as "bankXUMMF",
          COALESCE(bfs.xubf, 0)::float as "bankXUBF",
          COALESCE(bfs.xudef, 0)::float as "bankXUDEF",
          COALESCE(bfs.xuref, 0)::float as "bankXUREF",
          COALESCE(bfs.total, 0)::float as "bankTotal",
          COALESCE(gfs.xummf, 0)::float as "goalXUMMF",
          COALESCE(gfs.xubf, 0)::float as "goalXUBF",
          COALESCE(gfs.xudef, 0)::float as "goalXUDEF",
          COALESCE(gfs.xuref, 0)::float as "goalXUREF",
          COALESCE(gfs.total, 0)::float as "goalTotal"
        FROM goal_info gi
        LEFT JOIN bank_fund_summary bfs ON bfs."goalNumber" = gi."goalNumber"
        LEFT JOIN goal_fund_summary gfs ON gfs."goalNumber" = gi."goalNumber"
        WHERE (bfs.total IS NOT NULL OR gfs.total IS NOT NULL)
      ),
      goal_with_status AS (
        SELECT
          *,
          -- Calculate variances
          ("bankXUMMF" - "goalXUMMF") as xummf_var,
          ("bankXUBF" - "goalXUBF") as xubf_var,
          ("bankXUDEF" - "goalXUDEF") as xudef_var,
          ("bankXUREF" - "goalXUREF") as xuref_var,
          -- Check if goal has variance (any fund variance exceeds tolerance: max(1% of goalAmount, 1000))
          CASE WHEN (
            ABS("bankXUMMF" - "goalXUMMF") > GREATEST(ABS("goalXUMMF") * 0.01, 1000) OR
            ABS("bankXUBF" - "goalXUBF") > GREATEST(ABS("goalXUBF") * 0.01, 1000) OR
            ABS("bankXUDEF" - "goalXUDEF") > GREATEST(ABS("goalXUDEF") * 0.01, 1000) OR
            ABS("bankXUREF" - "goalXUREF") > GREATEST(ABS("goalXUREF") * 0.01, 1000)
          ) THEN 1 ELSE 0 END as has_variance
        FROM goal_level
      )
      SELECT
        "accountNumber",
        MAX("clientName") as "clientName",
        COUNT(DISTINCT "goalNumber") as "goalCount",
        SUM("bankXUMMF") as "bankXUMMF",
        SUM("bankXUBF") as "bankXUBF",
        SUM("bankXUDEF") as "bankXUDEF",
        SUM("bankXUREF") as "bankXUREF",
        SUM("bankTotal") as "bankTotal",
        SUM("goalXUMMF") as "goalXUMMF",
        SUM("goalXUBF") as "goalXUBF",
        SUM("goalXUDEF") as "goalXUDEF",
        SUM("goalXUREF") as "goalXUREF",
        SUM("goalTotal") as "goalTotal",
        SUM(CASE WHEN has_variance = 0 THEN 1 ELSE 0 END) as "matchedGoalCount",
        SUM(CASE WHEN has_variance = 1 THEN 1 ELSE 0 END) as "varianceGoalCount"
      FROM goal_with_status
      GROUP BY "accountNumber"
      ORDER BY "accountNumber"
    `;

    const rawResults = await prisma.$queryRawUnsafe(query, ...params) as any[];

    // Process results and add calculated fields
    // matchedGoalCount and varianceGoalCount are now computed in SQL
    const results: AccountFundSummary[] = rawResults.map((row) => {
      const xummfVariance = Number(row.bankXUMMF) - Number(row.goalXUMMF);
      const xubfVariance = Number(row.bankXUBF) - Number(row.goalXUBF);
      const xudefVariance = Number(row.bankXUDEF) - Number(row.goalXUDEF);
      const xurefVariance = Number(row.bankXUREF) - Number(row.goalXUREF);
      const totalVariance = Number(row.bankTotal) - Number(row.goalTotal);

      // Check if any fund has a variance beyond tolerance at account level
      const checkVariance = (goalAmount: number, variance: number): boolean => {
        const tolerance = Math.max(Math.abs(goalAmount) * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);
        return Math.abs(variance) > tolerance;
      };

      const hasXUMMFVariance = checkVariance(Number(row.goalXUMMF), xummfVariance);
      const hasXUBFVariance = checkVariance(Number(row.goalXUBF), xubfVariance);
      const hasXUDEFVariance = checkVariance(Number(row.goalXUDEF), xudefVariance);
      const hasXUREFVariance = checkVariance(Number(row.goalXUREF), xurefVariance);
      const hasAnyVariance = hasXUMMFVariance || hasXUBFVariance || hasXUDEFVariance || hasXUREFVariance;

      // matchedGoalCount and varianceGoalCount come directly from SQL
      const matchedGoalCount = Number(row.matchedGoalCount) || 0;
      const varianceGoalCount = Number(row.varianceGoalCount) || 0;

      return {
        accountNumber: row.accountNumber,
        clientName: row.clientName,
        goalCount: Number(row.goalCount),
        bankXUMMF: Number(row.bankXUMMF),
        bankXUBF: Number(row.bankXUBF),
        bankXUDEF: Number(row.bankXUDEF),
        bankXUREF: Number(row.bankXUREF),
        bankTotal: Number(row.bankTotal),
        goalXUMMF: Number(row.goalXUMMF),
        goalXUBF: Number(row.goalXUBF),
        goalXUDEF: Number(row.goalXUDEF),
        goalXUREF: Number(row.goalXUREF),
        goalTotal: Number(row.goalTotal),
        xummfVariance,
        xubfVariance,
        xudefVariance,
        xurefVariance,
        totalVariance,
        status: hasAnyVariance ? 'VARIANCE' : 'MATCHED',
        matchedGoalCount,
        varianceGoalCount,
      };
    });

    // Apply status filter if specified
    let filteredResults = results;
    if (filters?.status && filters.status !== 'ALL') {
      filteredResults = results.filter(r => r.status === filters.status);
    }

    return {
      data: filteredResults,
      total: filteredResults.length,
    };
  }

  /**
   * Get transactions for a specific goal with smart matching applied
   * Returns goal transactions (aggregated from fund transactions) instead of individual fund transactions
   */
  static async getGoalTransactions(
    goalNumber: string,
    startDate: Date,
    endDate: Date,
    transactionType?: 'DEPOSIT' | 'WITHDRAWAL'
  ): Promise<{
    bankTransactions: any[];
    goalTransactions: GoalTransaction[];
    matches: MatchResult[];
    unmatchedBank: string[];
    unmatchedGoalTxn: string[];
  }> {
    // Get bank transactions for this goal
    // Exclude Transfer_Reversal transactions (transactionId contains "Transfer_Reversal") and RT Change
    const bankTxns = await prisma.bankGoalTransaction.findMany({
      where: {
        goalNumber,
        transactionDate: { gte: startDate, lte: endDate },
        ...(transactionType && { transactionType }),
        AND: [
          { NOT: { transactionId: { contains: 'Transfer_Reversal' } } },
          { NOT: { transactionId: 'RT Change' } },
        ],
      },
      orderBy: { transactionDate: 'desc' },
    });

    // Get fund transactions for this goal
    const goal = await prisma.goal.findFirst({
      where: { goalNumber },
      select: { id: true },
    });

    if (!goal) {
      return {
        bankTransactions: bankTxns,
        goalTransactions: [],
        matches: [],
        unmatchedBank: bankTxns.map(b => b.id),
        unmatchedGoalTxn: [],
      };
    }

    const fundTxns = await prisma.fundTransaction.findMany({
      where: {
        goalId: goal.id,
        transactionDate: { gte: startDate, lte: endDate },
        ...(transactionType && { transactionType }),
        // Exclude Transfer_Reversal transactions from comparison
        // Prisma's 'not' filter includes null values by default
        source: { not: 'Transfer_Reversal' },
      },
      include: {
        fund: { select: { fundCode: true } },
      },
      orderBy: { transactionDate: 'desc' },
    });

    // Group fund transactions by goalTransactionCode AND transactionType to get goal transactions
    // This is important because the same goalTransactionCode can have both DEPOSIT and WITHDRAWAL
    // (e.g., when a deposit and withdrawal happen on the same day with the same transactionId)
    const goalTxnByCode = new Map<string, {
      ids: string[];
      total: number;
      date: Date;
      transactionId: string | null;
      type: string;
      xummf: number;
      xubf: number;
      xudef: number;
      xuref: number;
      // Review fields (take first non-null from group)
      reviewTag: string | null;
      reviewNotes: string | null;
      reviewedBy: string | null;
      reviewedAt: Date | null;
      // Store the original goalTransactionCode for matching purposes
      originalCode: string;
    }>();
    for (const ft of fundTxns) {
      // Use composite key: goalTransactionCode + transactionType
      const code = `${ft.goalTransactionCode}|${ft.transactionType}`;
      if (!goalTxnByCode.has(code)) {
        goalTxnByCode.set(code, {
          originalCode: ft.goalTransactionCode,
          ids: [],
          total: 0,
          date: ft.transactionDate,
          transactionId: ft.transactionId,
          type: ft.transactionType,
          xummf: 0,
          xubf: 0,
          xudef: 0,
          xuref: 0,
          reviewTag: ft.reviewTag,
          reviewNotes: ft.reviewNotes,
          reviewedBy: ft.reviewedBy,
          reviewedAt: ft.reviewedAt,
        });
      }
      const group = goalTxnByCode.get(code)!;
      group.ids.push(ft.id);
      const amount = Number(ft.amount);
      group.total += amount;
      // Track per-fund amounts
      const fundCode = ft.fund?.fundCode;
      if (fundCode === 'XUMMF') group.xummf += amount;
      else if (fundCode === 'XUBF') group.xubf += amount;
      else if (fundCode === 'XUDEF') group.xudef += amount;
      else if (fundCode === 'XUREF') group.xuref += amount;
      // Update review fields if current is null but this one has value
      if (!group.reviewTag && ft.reviewTag) group.reviewTag = ft.reviewTag;
      if (!group.reviewNotes && ft.reviewNotes) group.reviewNotes = ft.reviewNotes;
      if (!group.reviewedBy && ft.reviewedBy) group.reviewedBy = ft.reviewedBy;
      if (!group.reviewedAt && ft.reviewedAt) group.reviewedAt = ft.reviewedAt;
    }

    // Run matching algorithm
    const matches: MatchResult[] = [];
    const matchedBankIds = new Set<string>();
    const matchedFundIds = new Set<string>();

    // PASS 0: Check for existing MANUAL matches (matchedGoalTransactionCode starts with MANUAL:)
    // First, group bank transactions by their MANUAL: matchCode
    const manualMatchGroups = new Map<string, typeof bankTxns>();
    for (const bankTxn of bankTxns) {
      if (!bankTxn.matchedGoalTransactionCode) continue;
      if (!bankTxn.matchedGoalTransactionCode.startsWith('MANUAL:')) continue;

      const matchCode = bankTxn.matchedGoalTransactionCode;
      if (!manualMatchGroups.has(matchCode)) {
        manualMatchGroups.set(matchCode, []);
      }
      manualMatchGroups.get(matchCode)!.push(bankTxn);
    }

    // Process each MANUAL match group together
    for (const [matchCode, bankGroup] of manualMatchGroups) {
      if (bankGroup.every(b => matchedBankIds.has(b.id))) continue;

      // Extract goal transaction codes from the MANUAL match code
      // Format: MANUAL:{timestamp}:{goalTransactionCode1},{goalTransactionCode2},...
      const colonIndex = matchCode.indexOf(':', 7); // After "MANUAL:"
      if (colonIndex === -1) continue;

      const goalCodesStr = matchCode.substring(colonIndex + 1);
      const goalCodes = goalCodesStr.split(',');

      // Find all matching goal transactions
      // Note: goalCodes are originalCodes (without transactionType suffix)
      // We need to search by originalCode since the map key now includes transactionType
      const allFundIds: string[] = [];
      let fundTotal = 0;
      for (const goalCode of goalCodes) {
        // Search for entries where originalCode matches
        for (const [_, fundGroup] of goalTxnByCode.entries()) {
          if (fundGroup.originalCode === goalCode && !fundGroup.ids.some(id => matchedFundIds.has(id))) {
            allFundIds.push(...fundGroup.ids);
            fundTotal += fundGroup.total;
          }
        }
      }

      if (allFundIds.length > 0) {
        const unmatchedBanks = bankGroup.filter(b => !matchedBankIds.has(b.id));
        const bankTotal = unmatchedBanks.reduce((sum, b) => sum + Number(b.totalAmount), 0);
        matches.push({
          bankIds: unmatchedBanks.map(b => b.id),
          fundIds: allFundIds,
          matchType: 'MANUAL',
          confidence: 1.0,
          bankTotal,
          fundTotal,
        });
        unmatchedBanks.forEach(b => matchedBankIds.add(b.id));
        allFundIds.forEach(id => matchedFundIds.add(id));
      }
    }

    // PASS 1: Exact match by transactionId
    for (const bankTxn of bankTxns) {
      if (matchedBankIds.has(bankTxn.id)) continue;

      // Find fund transactions with same transactionId
      const matchingFundGroups = Array.from(goalTxnByCode.entries()).filter(
        ([_, group]) => group.transactionId === bankTxn.transactionId &&
                       group.type === bankTxn.transactionType &&
                       !group.ids.some(id => matchedFundIds.has(id))
      );

      if (matchingFundGroups.length > 0) {
        const fundGroup = matchingFundGroups[0][1];
        const bankAmount = Number(bankTxn.totalAmount);
        const tolerance = Math.max(fundGroup.total * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);

        if (Math.abs(bankAmount - fundGroup.total) <= tolerance) {
          matches.push({
            bankIds: [bankTxn.id],
            fundIds: fundGroup.ids,
            matchType: 'EXACT',
            confidence: 1.0,
            bankTotal: bankAmount,
            fundTotal: fundGroup.total,
          });
          matchedBankIds.add(bankTxn.id);
          fundGroup.ids.forEach(id => matchedFundIds.add(id));
        }
      }
    }

    // PASS 2: Amount-based matching within date window
    const unmatchedBankTxns = bankTxns.filter(b => !matchedBankIds.has(b.id));
    const unmatchedFundGroups = Array.from(goalTxnByCode.entries()).filter(
      ([_, group]) => !group.ids.some(id => matchedFundIds.has(id))
    );

    for (const bankTxn of unmatchedBankTxns) {
      if (matchedBankIds.has(bankTxn.id)) continue;

      const bankAmount = Number(bankTxn.totalAmount);
      const bankDate = new Date(bankTxn.transactionDate);

      // Find fund groups with matching amount within date window
      for (const [, fundGroup] of unmatchedFundGroups) {
        if (fundGroup.ids.some(id => matchedFundIds.has(id))) continue;
        if (fundGroup.type !== bankTxn.transactionType) continue;

        const fundDate = new Date(fundGroup.date);
        const daysDiff = Math.abs((bankDate.getTime() - fundDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= DATE_WINDOW_DAYS) {
          const tolerance = Math.max(fundGroup.total * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN);

          if (Math.abs(bankAmount - fundGroup.total) <= tolerance) {
            matches.push({
              bankIds: [bankTxn.id],
              fundIds: fundGroup.ids,
              matchType: 'AMOUNT',
              confidence: 0.8 - (daysDiff / DATE_WINDOW_DAYS) * 0.3, // Higher confidence for closer dates
              bankTotal: bankAmount,
              fundTotal: fundGroup.total,
            });
            matchedBankIds.add(bankTxn.id);
            fundGroup.ids.forEach(id => matchedFundIds.add(id));
            break;
          }
        }
      }
    }

    // PASS 3: Split detection - N bank → 1 fund
    const stillUnmatchedBank = bankTxns.filter(b => !matchedBankIds.has(b.id));
    const stillUnmatchedFundGroups = Array.from(goalTxnByCode.entries()).filter(
      ([_, group]) => !group.ids.some(id => matchedFundIds.has(id))
    );

    // Group unmatched bank by date and type for split detection
    const bankByDateType = new Map<string, typeof stillUnmatchedBank>();
    for (const bankTxn of stillUnmatchedBank) {
      const dateStr = bankTxn.transactionDate.toISOString().split('T')[0];
      const key = `${dateStr}-${bankTxn.transactionType}`;
      if (!bankByDateType.has(key)) {
        bankByDateType.set(key, []);
      }
      bankByDateType.get(key)!.push(bankTxn);
    }

    // Check if multiple bank transactions sum to one fund transaction
    for (const [, fundGroup] of stillUnmatchedFundGroups) {
      if (fundGroup.ids.some(id => matchedFundIds.has(id))) continue;

      const fundDateStr = fundGroup.date.toISOString().split('T')[0];
      const key = `${fundDateStr}-${fundGroup.type}`;
      const bankCandidates = bankByDateType.get(key) || [];

      // Try combinations of bank transactions
      const unmatchedCandidates = bankCandidates.filter(b => !matchedBankIds.has(b.id));
      const combination = this.findCombinationSum(
        unmatchedCandidates.map(b => ({ id: b.id, amount: Number(b.totalAmount) })),
        fundGroup.total,
        Math.max(fundGroup.total * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN)
      );

      if (combination.length > 1) {
        matches.push({
          bankIds: combination.map(c => c.id),
          fundIds: fundGroup.ids,
          matchType: 'SPLIT_BANK_TO_FUND',
          confidence: 0.7,
          bankTotal: combination.reduce((sum, c) => sum + c.amount, 0),
          fundTotal: fundGroup.total,
        });
        combination.forEach(c => matchedBankIds.add(c.id));
        fundGroup.ids.forEach(id => matchedFundIds.add(id));
      }
    }

    // PASS 3b: Split detection - N fund → 1 bank
    const finalUnmatchedBank = bankTxns.filter(b => !matchedBankIds.has(b.id));
    const finalUnmatchedFundGroups = Array.from(goalTxnByCode.entries()).filter(
      ([_, group]) => !group.ids.some(id => matchedFundIds.has(id))
    );

    for (const bankTxn of finalUnmatchedBank) {
      if (matchedBankIds.has(bankTxn.id)) continue;

      const bankDateStr = bankTxn.transactionDate.toISOString().split('T')[0];
      const bankAmount = Number(bankTxn.totalAmount);

      // Find fund groups on same day with same type
      const fundCandidates = finalUnmatchedFundGroups.filter(([_, group]) => {
        if (group.ids.some(id => matchedFundIds.has(id))) return false;
        if (group.type !== bankTxn.transactionType) return false;
        const fundDateStr = group.date.toISOString().split('T')[0];
        return fundDateStr === bankDateStr;
      });

      // Try combinations of fund groups
      const fundWithAmounts = fundCandidates.map(([, group]) => ({
        ids: group.ids,
        amount: group.total,
      }));

      const combination = this.findCombinationSum(
        fundWithAmounts.map((f, i) => ({ id: String(i), amount: f.amount })),
        bankAmount,
        Math.max(bankAmount * AMOUNT_TOLERANCE_PERCENT, AMOUNT_TOLERANCE_MIN)
      );

      if (combination.length > 1) {
        const matchedFundGroupIds = combination.flatMap(c => fundWithAmounts[parseInt(c.id)].ids);
        matches.push({
          bankIds: [bankTxn.id],
          fundIds: matchedFundGroupIds,
          matchType: 'SPLIT_FUND_TO_BANK',
          confidence: 0.7,
          bankTotal: bankAmount,
          fundTotal: combination.reduce((sum, c) => sum + c.amount, 0),
        });
        matchedBankIds.add(bankTxn.id);
        matchedFundGroupIds.forEach(id => matchedFundIds.add(id));
      }
    }

    // Build goal transactions from grouped data
    // Note: Use originalCode for goalTransactionCode (the map key includes transactionType but we don't want that in the output)
    const goalTransactions: GoalTransaction[] = Array.from(goalTxnByCode.entries()).map(
      ([_, group]) => ({
        goalTransactionCode: group.originalCode,
        transactionDate: group.date,
        transactionId: group.transactionId,
        transactionType: group.type,
        totalAmount: group.total,
        xummfAmount: group.xummf,
        xubfAmount: group.xubf,
        xudefAmount: group.xudef,
        xurefAmount: group.xuref,
        fundTransactionIds: group.ids,
        reviewTag: group.reviewTag,
        reviewNotes: group.reviewNotes,
        reviewedBy: group.reviewedBy,
        reviewedAt: group.reviewedAt,
      })
    );

    // Determine unmatched goal transactions (by composite key: goalTransactionCode|transactionType)
    // We use the composite key because the same goalTransactionCode can have both DEPOSIT and WITHDRAWAL
    const matchedGoalTxnKeys = new Set<string>();
    for (const match of matches) {
      // Find which goal transaction keys are matched based on their fund transaction IDs
      for (const [compositeKey, group] of goalTxnByCode.entries()) {
        if (group.ids.some((id: string) => match.fundIds.includes(id))) {
          matchedGoalTxnKeys.add(compositeKey);
        }
      }
    }

    // Auto-persist non-MANUAL matches to database
    // This ensures the summary correctly identifies matched transactions
    const nonManualMatches = matches.filter(m => m.matchType !== 'MANUAL');
    if (nonManualMatches.length > 0) {
      for (const match of nonManualMatches) {
        // Get all goal transaction codes for this match
        // Use originalCode (not the composite key which includes transactionType)
        const goalCodesForMatch: string[] = [];
        for (const [_, group] of goalTxnByCode.entries()) {
          if (group.ids.some((id: string) => match.fundIds.includes(id))) {
            goalCodesForMatch.push(group.originalCode);
          }
        }

        if (goalCodesForMatch.length > 0) {
          // For algorithmic matches, store as: {matchType}:{goalTransactionCode(s)}
          // This distinguishes from MANUAL matches and allows tracking match type
          const matchCode = goalCodesForMatch.length === 1
            ? goalCodesForMatch[0]  // Single goal code - store directly
            : `${match.matchType}:${goalCodesForMatch.join(',')}`; // Multiple - prefix with type

          await prisma.bankGoalTransaction.updateMany({
            where: { id: { in: match.bankIds } },
            data: {
              matchedGoalTransactionCode: matchCode,
              matchedAt: new Date(),
              matchScore: Math.round(match.confidence * 100),
              updatedAt: new Date(),
            },
          });
        }
      }
    }

    return {
      bankTransactions: bankTxns,
      goalTransactions,
      matches,
      unmatchedBank: bankTxns.filter(b => !matchedBankIds.has(b.id)).map(b => b.id),
      unmatchedGoalTxn: goalTransactions
        .filter(gt => !matchedGoalTxnKeys.has(`${gt.goalTransactionCode}|${gt.transactionType}`))
        .map(gt => gt.goalTransactionCode),
    };
  }

  /**
   * Find a combination of items that sum to target (within tolerance)
   * Uses a simple greedy + subset approach for reasonable performance
   */
  private static findCombinationSum(
    items: { id: string; amount: number }[],
    target: number,
    tolerance: number
  ): { id: string; amount: number }[] {
    // Sort by amount descending
    const sorted = [...items].sort((a, b) => b.amount - a.amount);

    // Try greedy approach first
    let sum = 0;
    const result: typeof items = [];

    for (const item of sorted) {
      if (sum + item.amount <= target + tolerance) {
        result.push(item);
        sum += item.amount;

        if (Math.abs(sum - target) <= tolerance) {
          return result;
        }
      }
    }

    // If greedy didn't work, try all subsets (limited to first 10 items for performance)
    const limitedItems = sorted.slice(0, 10);
    const n = limitedItems.length;

    for (let mask = 1; mask < (1 << n); mask++) {
      let subsetSum = 0;
      const subset: typeof items = [];

      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          subset.push(limitedItems[i]);
          subsetSum += limitedItems[i].amount;
        }
      }

      if (subset.length > 1 && Math.abs(subsetSum - target) <= tolerance) {
        return subset;
      }
    }

    return [];
  }

  /**
   * Apply match results and update reconciliation status
   * Also sets matchedGoalTransactionCode to link bank transactions to their matched goal transactions
   */
  static async applyMatches(
    matches: MatchResult[],
    updateStatus: boolean = false
  ): Promise<{ updated: number }> {
    if (!updateStatus) {
      return { updated: 0 };
    }

    let updated = 0;

    for (const match of matches) {
      // Find the goalTransactionCode from the matched fund transactions
      // All fund transactions in a match should have the same goalTransactionCode
      let matchedGoalTransactionCode: string | null = null;
      if (match.fundIds.length > 0) {
        const fundTxn = await prisma.fundTransaction.findFirst({
          where: { id: match.fundIds[0] },
          select: { goalTransactionCode: true },
        });
        matchedGoalTransactionCode = fundTxn?.goalTransactionCode || null;
      }

      // Update bank transaction statuses and set the matched goal transaction code
      await prisma.bankGoalTransaction.updateMany({
        where: { id: { in: match.bankIds } },
        data: {
          reconciliationStatus: ReconciliationStatus.MATCHED,
          matchedGoalTransactionCode,
          matchedAt: new Date(),
          matchScore: Math.round(match.confidence * 100),
          updatedAt: new Date(),
        },
      });
      updated += match.bankIds.length;
    }

    return { updated };
  }

  // ============================================================================
  // VARIANCE REVIEW METHODS
  // ============================================================================

  /**
   * Review a single bank transaction
   */
  static async reviewBankTransaction(
    transactionId: string,
    reviewTag: string,
    reviewNotes: string | null,
    reviewedBy: string
  ): Promise<{ success: boolean; transaction: any }> {
    const transaction = await prisma.bankGoalTransaction.update({
      where: { id: transactionId },
      data: {
        reviewTag: reviewTag as any, // Cast to enum
        reviewNotes,
        reviewedAt: new Date(),
        reviewedBy,
      },
      include: {
        client: { select: { clientName: true } },
        goal: { select: { goalNumber: true, goalTitle: true } },
      },
    });

    return { success: true, transaction };
  }

  /**
   * Review goal transactions by goalTransactionCode
   * Updates all fund transactions with the same code
   */
  static async reviewGoalTransaction(
    goalTransactionCode: string,
    reviewTag: string,
    reviewNotes: string | null,
    reviewedBy: string
  ): Promise<{ success: boolean; updatedCount: number }> {
    const result = await prisma.fundTransaction.updateMany({
      where: { goalTransactionCode },
      data: {
        reviewTag: reviewTag as any,
        reviewNotes,
        reviewedAt: new Date(),
        reviewedBy,
      },
    });

    return { success: true, updatedCount: result.count };
  }

  /**
   * Bulk review multiple transactions
   */
  static async bulkReview(
    bankTransactionIds: string[],
    goalTransactionCodes: string[],
    reviewTag: string,
    reviewNotes: string | null,
    reviewedBy: string
  ): Promise<{ bank: number; goal: number }> {
    let bankUpdated = 0;
    let goalUpdated = 0;

    if (bankTransactionIds.length > 0) {
      const result = await prisma.bankGoalTransaction.updateMany({
        where: { id: { in: bankTransactionIds } },
        data: {
          reviewTag: reviewTag as any,
          reviewNotes,
          reviewedAt: new Date(),
          reviewedBy,
        },
      });
      bankUpdated = result.count;
    }

    if (goalTransactionCodes.length > 0) {
      const result = await prisma.fundTransaction.updateMany({
        where: { goalTransactionCode: { in: goalTransactionCodes } },
        data: {
          reviewTag: reviewTag as any,
          reviewNotes,
          reviewedAt: new Date(),
          reviewedBy,
        },
      });
      goalUpdated = result.count;
    }

    return { bank: bankUpdated, goal: goalUpdated };
  }

  /**
   * Get review status for a specific goal
   */
  static async getGoalReviewStatus(
    goalNumber: string,
    startDate: string,
    endDate: string
  ): Promise<{
    goalNumber: string;
    status: 'PENDING' | 'PARTIALLY_REVIEWED' | 'FULLY_REVIEWED' | 'NO_VARIANCES';
    totalUnmatched: number;
    reviewedCount: number;
    pendingCount: number;
    byTag: Record<string, number>;
  }> {
    // Get bank transactions not matched by transactionId (variance transactions)
    // Include their review status (tagged or Smart Matched)
    const bankQuery = `
      SELECT
        b.id,
        b."reviewTag",
        b."matchedGoalTransactionCode"
      FROM bank_goal_transactions b
      WHERE b."goalNumber" = $1
        AND b."transactionDate"::date >= $2::date
        AND b."transactionDate"::date <= $3::date
        AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
        -- Only transactions NOT matched by transactionId (variance transactions)
        AND NOT EXISTS (
          SELECT 1 FROM fund_transactions f
          JOIN goals g ON f."goalId" = g.id
          WHERE g."goalNumber" = b."goalNumber"
            AND f."transactionId" = b."transactionId"
            AND f."transactionType" = b."transactionType"
            AND f."transactionDate"::date >= $2::date AND f."transactionDate"::date <= $3::date
            AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
        )
    `;
    const unmatchedBank = await prisma.$queryRawUnsafe(bankQuery, goalNumber, startDate, endDate) as any[];

    // Get goal transactions not matched by transactionId (variance transactions)
    // Check if they are tagged or referenced by a bank's matchedGoalTransactionCode
    const goalQuery = `
      SELECT
        f."goalTransactionCode",
        f."reviewTag",
        CASE WHEN EXISTS (
          SELECT 1 FROM bank_goal_transactions b
          WHERE b."goalNumber" = g."goalNumber"
            AND b."matchedGoalTransactionCode" IS NOT NULL
            AND (
              b."matchedGoalTransactionCode" = f."goalTransactionCode"
              OR f."goalTransactionCode" = ANY(string_to_array(
                CASE
                  WHEN b."matchedGoalTransactionCode" LIKE 'MANUAL:%' THEN split_part(b."matchedGoalTransactionCode", ':', 3)
                  WHEN b."matchedGoalTransactionCode" LIKE '%:%' THEN split_part(b."matchedGoalTransactionCode", ':', 2)
                  ELSE b."matchedGoalTransactionCode"
                END,
                ','
              ))
            )
        ) THEN true ELSE false END as is_smart_matched
      FROM fund_transactions f
      JOIN goals g ON f."goalId" = g.id
      WHERE g."goalNumber" = $1
        AND f."transactionDate"::date >= $2::date
        AND f."transactionDate"::date <= $3::date
        AND (f."source" IS NULL OR f."source" != 'Transfer_Reversal')
        -- Only transactions NOT matched by transactionId (variance transactions)
        AND NOT EXISTS (
          SELECT 1 FROM bank_goal_transactions b
          WHERE b."goalNumber" = g."goalNumber"
            AND b."transactionId" = f."transactionId"
            AND b."transactionType" = f."transactionType"
            AND b."transactionDate"::date >= $2::date AND b."transactionDate"::date <= $3::date
            AND (b."transactionId" IS NULL OR (b."transactionId" NOT LIKE '%Transfer_Reversal%' AND b."transactionId" != 'RT Change'))
        )
      GROUP BY f."goalTransactionCode", f."reviewTag", g."goalNumber"
    `;
    const unmatchedGoal = await prisma.$queryRawUnsafe(goalQuery, goalNumber, startDate, endDate) as any[];

    // Combine and count
    // A transaction is "reviewed" if it has a reviewTag OR is matched by Smart Matcher
    const allUnmatched = [
      ...unmatchedBank.map(b => ({
        type: 'BANK',
        reviewTag: b.reviewTag,
        isReviewed: b.reviewTag !== null || b.matchedGoalTransactionCode !== null,
      })),
      ...unmatchedGoal.map(g => ({
        type: 'GOAL',
        reviewTag: g.reviewTag,
        isReviewed: g.reviewTag !== null || g.is_smart_matched === true,
      })),
    ];

    const totalUnmatched = allUnmatched.length;
    const reviewedCount = allUnmatched.filter(t => t.isReviewed).length;
    const pendingCount = totalUnmatched - reviewedCount;

    // Count by tag
    const byTag: Record<string, number> = {};
    for (const t of allUnmatched) {
      if (t.reviewTag) {
        byTag[t.reviewTag] = (byTag[t.reviewTag] || 0) + 1;
      }
    }

    let status: 'PENDING' | 'PARTIALLY_REVIEWED' | 'FULLY_REVIEWED' | 'NO_VARIANCES';
    if (totalUnmatched === 0) {
      status = 'NO_VARIANCES';
    } else if (pendingCount === 0) {
      status = 'FULLY_REVIEWED';
    } else if (reviewedCount > 0) {
      status = 'PARTIALLY_REVIEWED';
    } else {
      status = 'PENDING';
    }

    return {
      goalNumber,
      status,
      totalUnmatched,
      reviewedCount,
      pendingCount,
      byTag,
    };
  }

  /**
   * Get all variance (unmatched) transactions for the Variance Review tab
   * Uses the SAME smart matching logic as Goal Comparison drilldown (getGoalTransactions)
   * This ensures Transaction Comparison and Goal Comparison show identical unmatched transactions
   */
  static async getVarianceTransactions(
    startDate: string,
    endDate: string,
    filters?: {
      reviewStatus?: 'PENDING' | 'REVIEWED' | 'ALL';
      reviewTag?: string;
      goalNumber?: string;
      clientSearch?: string;
      resolutionStatus?: 'RESOLVED' | 'PENDING' | 'ALL';
      transactionSource?: 'BANK' | 'GOAL';
    }
  ): Promise<{
    data: any[];
    summary: {
      totalUnmatched: number;
      pendingReview: number;
      reviewed: number;
      byTag: Record<string, number>;
      missingInBankCount: number;  // GOAL transactions (fund exists, no bank)
      missingInFundCount: number;  // BANK transactions (bank exists, no fund)
    };
  }> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Step 1: Get all goals that have any bank or fund transactions in the date range
    const goalsWithTransactions = await prisma.$queryRaw<{ goalNumber: string }[]>`
      SELECT DISTINCT goal_number as "goalNumber" FROM (
        SELECT b."goalNumber" as goal_number
        FROM bank_goal_transactions b
        WHERE b."transactionDate"::date >= ${startDate}::date
          AND b."transactionDate"::date <= ${endDate}::date
        UNION
        SELECT g."goalNumber" as goal_number
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g.id
        WHERE f."transactionDate"::date >= ${startDate}::date
          AND f."transactionDate"::date <= ${endDate}::date
      ) goals
      ORDER BY goal_number
    `;

    // Filter by goal number if provided
    let goalNumbers = goalsWithTransactions.map(g => g.goalNumber);
    if (filters?.goalNumber) {
      const searchTerm = filters.goalNumber.toLowerCase();
      goalNumbers = goalNumbers.filter(gn => gn.toLowerCase().includes(searchTerm));
    }

    // Step 2: For each goal, run smart matching and collect unmatched transactions
    const allUnmatchedBankIds: string[] = [];
    const allUnmatchedGoalCodes: string[] = [];

    for (const goalNumber of goalNumbers) {
      const result = await this.getGoalTransactions(goalNumber, start, end);
      allUnmatchedBankIds.push(...result.unmatchedBank);
      allUnmatchedGoalCodes.push(...result.unmatchedGoalTxn);
    }

    // Step 3: Fetch full details for unmatched bank transactions
    let unmatchedBankData: any[] = [];
    if (allUnmatchedBankIds.length > 0 && (!filters?.transactionSource || filters.transactionSource === 'BANK')) {
      unmatchedBankData = await prisma.$queryRaw<any[]>`
        SELECT
          'BANK' as transaction_source,
          b.id,
          b."goalNumber" as goal_number,
          c."clientName" as client_name,
          a."accountNumber" as account_number,
          b."transactionDate" as transaction_date,
          b."transactionType" as transaction_type,
          b."totalAmount" as amount,
          b."xummfAmount" as xummf_amount,
          b."xubfAmount" as xubf_amount,
          b."xudefAmount" as xudef_amount,
          b."xurefAmount" as xuref_amount,
          b."transactionId" as source_transaction_id,
          b."reviewTag"::text as review_tag,
          b."reviewNotes" as review_notes,
          b."reviewedBy" as reviewed_by,
          b."reviewedAt" as reviewed_at,
          b."varianceResolved" as variance_resolved,
          b."resolvedAt" as resolved_at,
          b."resolvedReason" as resolved_reason
        FROM bank_goal_transactions b
        JOIN clients c ON b."clientId" = c.id
        JOIN accounts a ON b."accountId" = a.id
        WHERE b.id = ANY(${allUnmatchedBankIds})
        ORDER BY b."transactionDate" DESC, b."goalNumber"
      `;
    }

    // Step 4: Fetch full details for unmatched goal transactions
    let unmatchedGoalData: any[] = [];
    if (allUnmatchedGoalCodes.length > 0 && (!filters?.transactionSource || filters.transactionSource === 'GOAL')) {
      unmatchedGoalData = await prisma.$queryRaw<any[]>`
        SELECT
          'GOAL' as transaction_source,
          f."goalTransactionCode" as id,
          g."goalNumber" as goal_number,
          c."clientName" as client_name,
          a."accountNumber" as account_number,
          f."transactionDate" as transaction_date,
          f."transactionType" as transaction_type,
          SUM(f."amount") as amount,
          SUM(CASE WHEN fund."fundCode" = 'XUMMF' THEN f."amount" ELSE 0 END) as xummf_amount,
          SUM(CASE WHEN fund."fundCode" = 'XUBF' THEN f."amount" ELSE 0 END) as xubf_amount,
          SUM(CASE WHEN fund."fundCode" = 'XUDEF' THEN f."amount" ELSE 0 END) as xudef_amount,
          SUM(CASE WHEN fund."fundCode" = 'XUREF' THEN f."amount" ELSE 0 END) as xuref_amount,
          f."transactionId" as source_transaction_id,
          MAX(f."reviewTag"::text) as review_tag,
          MAX(f."reviewNotes") as review_notes,
          MAX(f."reviewedBy") as reviewed_by,
          MAX(f."reviewedAt") as reviewed_at,
          BOOL_OR(f."varianceResolved") as variance_resolved,
          MAX(f."resolvedAt") as resolved_at,
          MAX(f."resolvedReason") as resolved_reason
        FROM fund_transactions f
        JOIN goals g ON f."goalId" = g.id
        JOIN accounts a ON g."accountId" = a.id
        JOIN clients c ON a."clientId" = c.id
        JOIN funds fund ON f."fundId" = fund.id
        WHERE f."goalTransactionCode" = ANY(${allUnmatchedGoalCodes})
        GROUP BY f."goalTransactionCode", g."goalNumber", c."clientName", a."accountNumber",
                 f."transactionDate", f."transactionType", f."transactionId"
        ORDER BY f."transactionDate" DESC, g."goalNumber"
      `;
    }

    // Step 5: Combine and apply filters
    let results = [...unmatchedBankData, ...unmatchedGoalData];

    // Apply client search filter
    if (filters?.clientSearch) {
      const searchTerm = filters.clientSearch.toLowerCase();
      results = results.filter(r => r.client_name.toLowerCase().includes(searchTerm));
    }

    // Apply review tag filter
    if (filters?.reviewTag) {
      if (filters.reviewTag === '__NO_TAG__') {
        results = results.filter(r => !r.review_tag);
      } else if (filters.reviewTag === '__ANY_TAG__') {
        results = results.filter(r => r.review_tag);
      } else {
        results = results.filter(r => r.review_tag === filters.reviewTag);
      }
    }

    // Apply review status filter
    if (filters?.reviewStatus === 'PENDING') {
      results = results.filter(r => !r.review_tag);
    } else if (filters?.reviewStatus === 'REVIEWED') {
      results = results.filter(r => r.review_tag);
    }

    // Apply resolution status filter
    if (filters?.resolutionStatus === 'RESOLVED') {
      results = results.filter(r => r.variance_resolved === true);
    } else if (filters?.resolutionStatus === 'PENDING') {
      results = results.filter(r => !r.variance_resolved);
    }

    // Sort by date descending, then goal number
    results.sort((a, b) => {
      const dateCompare = new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.goal_number.localeCompare(b.goal_number);
    });

    // Calculate summary (before transactionSource filter for accurate tab counts)
    const allResults = [...unmatchedBankData, ...unmatchedGoalData];
    const totalUnmatched = allResults.length;
    const pendingReview = allResults.filter(r => !r.review_tag).length;
    const reviewed = totalUnmatched - pendingReview;
    const missingInBankCount = allResults.filter(r => r.transaction_source === 'GOAL').length;
    const missingInFundCount = allResults.filter(r => r.transaction_source === 'BANK').length;

    const byTag: Record<string, number> = {};
    for (const r of allResults) {
      if (r.review_tag) {
        byTag[r.review_tag] = (byTag[r.review_tag] || 0) + 1;
      }
    }

    return {
      data: results.map(r => ({
        transactionSource: r.transaction_source,
        id: r.id,
        goalNumber: r.goal_number,
        clientName: r.client_name,
        accountNumber: r.account_number,
        transactionDate: r.transaction_date,
        transactionType: r.transaction_type,
        amount: Number(r.amount),
        xummfAmount: Number(r.xummf_amount) || 0,
        xubfAmount: Number(r.xubf_amount) || 0,
        xudefAmount: Number(r.xudef_amount) || 0,
        xurefAmount: Number(r.xuref_amount) || 0,
        sourceTransactionId: r.source_transaction_id,
        reviewTag: r.review_tag,
        reviewNotes: r.review_notes,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        varianceResolved: r.variance_resolved || false,
        resolvedAt: r.resolved_at,
        resolvedReason: r.resolved_reason,
      })),
      summary: {
        totalUnmatched,
        pendingReview,
        reviewed,
        byTag,
        missingInBankCount,
        missingInFundCount,
      },
    };
  }

  /**
   * Create a manual match between bank and goal transactions
   * Links selected bank transactions to selected goal transactions
   */
  static async createManualMatch(
    bankTransactionIds: string[],
    goalTransactionCodes: string[],
    matchedBy: string
  ): Promise<{
    matchedBankCount: number;
    matchedGoalCount: number;
    bankTotal: number;
    goalTotal: number;
  }> {
    // Get bank transactions
    const bankTxns = await prisma.bankGoalTransaction.findMany({
      where: { id: { in: bankTransactionIds } },
    });

    if (bankTxns.length !== bankTransactionIds.length) {
      throw new Error(`Some bank transactions not found. Expected ${bankTransactionIds.length}, found ${bankTxns.length}`);
    }

    // Get goal transactions (fund transactions grouped by goalTransactionCode)
    const fundTxns = await prisma.fundTransaction.findMany({
      where: { goalTransactionCode: { in: goalTransactionCodes } },
    });

    // Group fund transactions by goalTransactionCode
    const goalTxnMap = new Map<string, number>();
    for (const ft of fundTxns) {
      const code = ft.goalTransactionCode;
      if (code) {
        goalTxnMap.set(code, (goalTxnMap.get(code) || 0) + Number(ft.amount));
      }
    }

    if (goalTxnMap.size !== goalTransactionCodes.length) {
      throw new Error(`Some goal transactions not found. Expected ${goalTransactionCodes.length}, found ${goalTxnMap.size}`);
    }

    // Calculate totals
    const bankTotal = bankTxns.reduce((sum, t) => sum + Number(t.totalAmount), 0);
    const goalTotal = Array.from(goalTxnMap.values()).reduce((sum, amt) => sum + amt, 0);

    // Validate totals match within 1% tolerance
    const tolerance = Math.max(bankTotal * 0.01, 1); // 1% or 1 UGX minimum
    if (Math.abs(bankTotal - goalTotal) > tolerance) {
      throw new Error(
        `Totals do not match within tolerance. Bank: ${bankTotal.toLocaleString()}, Goal: ${goalTotal.toLocaleString()}, Difference: ${Math.abs(bankTotal - goalTotal).toLocaleString()}`
      );
    }

    // Create a match code for manual matches
    // Format: MANUAL:{timestamp}:{goalTransactionCode1},{goalTransactionCode2},...
    // Always use MANUAL: prefix to distinguish from algorithmic matches
    const matchCode = `MANUAL:${Date.now()}:${goalTransactionCodes.join(',')}`;

    // Update bank transactions with the match
    // Set both matchedGoalTransactionCode AND reconciliationStatus for consistency across views
    await prisma.bankGoalTransaction.updateMany({
      where: { id: { in: bankTransactionIds } },
      data: {
        matchedGoalTransactionCode: matchCode,
        reconciliationStatus: 'MATCHED',
        matchedAt: new Date(),
        matchScore: 100, // Manual match = 100% confidence
        updatedAt: new Date(),
      },
    });

    logger.info('Created manual match', {
      bankTransactionIds,
      goalTransactionCodes,
      matchCode,
      bankTotal,
      goalTotal,
      matchedBy,
    });

    return {
      matchedBankCount: bankTxns.length,
      matchedGoalCount: goalTransactionCodes.length,
      bankTotal,
      goalTotal,
    };
  }

  /**
   * Remove a manual match
   * Unlinks bank transactions from their matched goal transactions
   */
  static async removeManualMatch(
    bankTransactionIds: string[],
    goalTransactionCodes: string[]
  ): Promise<number> {
    let unmatched = 0;

    // Unmatch by bank transaction IDs
    // Reset both matchedGoalTransactionCode AND reconciliationStatus for consistency across views
    if (bankTransactionIds.length > 0) {
      const result = await prisma.bankGoalTransaction.updateMany({
        where: { id: { in: bankTransactionIds } },
        data: {
          matchedGoalTransactionCode: null,
          reconciliationStatus: 'PENDING',
          matchedAt: null,
          matchScore: null,
          updatedAt: new Date(),
        },
      });
      unmatched += result.count;
    }

    // Unmatch by goal transaction codes
    // For MANUAL: format, the matchedGoalTransactionCode contains the goal codes after MANUAL:{timestamp}:
    // So we search for codes that contain any of the provided goalTransactionCodes
    if (goalTransactionCodes.length > 0) {
      // First, try exact match (for old format or plain goalTransactionCode)
      const exactResult = await prisma.bankGoalTransaction.updateMany({
        where: { matchedGoalTransactionCode: { in: goalTransactionCodes } },
        data: {
          matchedGoalTransactionCode: null,
          reconciliationStatus: 'PENDING',
          matchedAt: null,
          matchScore: null,
          updatedAt: new Date(),
        },
      });
      unmatched += exactResult.count;

      // Also search for MANUAL: prefixed codes containing these goal codes
      for (const goalCode of goalTransactionCodes) {
        const containsResult = await prisma.bankGoalTransaction.updateMany({
          where: {
            matchedGoalTransactionCode: { contains: goalCode },
            AND: { matchedGoalTransactionCode: { startsWith: 'MANUAL:' } },
          },
          data: {
            matchedGoalTransactionCode: null,
            reconciliationStatus: 'PENDING',
            matchedAt: null,
            matchScore: null,
            updatedAt: new Date(),
          },
        });
        unmatched += containsResult.count;
      }
    }

    logger.info('Removed manual match', {
      bankTransactionIds,
      goalTransactionCodes,
      unmatched,
    });

    return unmatched;
  }

  // ============================================================================
  // REVERSAL LINKING METHODS
  // ============================================================================

  /**
   * Find potential reversal candidates for a transaction
   * Returns unmatched transactions with same goal, same absolute amount, opposite transaction type
   */
  static async findReversalCandidates(
    transactionId: string,
    dateRange?: { startDate: string; endDate: string }
  ): Promise<{
    sourceTransaction: any;
    candidates: any[];
  }> {
    // Get the source transaction
    const sourceTransaction = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId },
      include: {
        client: true,
        account: true,
        goal: true,
      },
    });

    if (!sourceTransaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    // Determine opposite transaction type
    const oppositeType = sourceTransaction.transactionType === 'DEPOSIT' ? 'WITHDRAWAL' : 'DEPOSIT';

    // Calculate the negated amount for matching
    // Deposits are positive, withdrawals are negative
    // If source is DEPOSIT of 2,275,000 → look for WITHDRAWAL of -2,275,000
    // If source is WITHDRAWAL of -2,275,000 → look for DEPOSIT of 2,275,000
    const sourceAmount = Number(sourceTransaction.totalAmount);
    const targetAmount = -sourceAmount; // Negate to find opposite
    // Convert to Prisma Decimal for proper comparison (totalAmount is Decimal(18,2))
    const targetAmountDecimal = new Prisma.Decimal(targetAmount);

    // Build date range filter
    let dateFilter: any = {};
    if (dateRange) {
      dateFilter = {
        transactionDate: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      };
    }

    // Find candidates: same goal, negated amount (opposite sign), opposite type, unmatched (in variance)
    const candidates = await prisma.bankGoalTransaction.findMany({
      where: {
        id: { not: transactionId }, // Not the same transaction
        goalNumber: sourceTransaction.goalNumber,
        transactionType: oppositeType,
        totalAmount: targetAmountDecimal, // Negated amount as Decimal (e.g., if source is 2,275,000 DEPOSIT, find -2,275,000 WITHDRAWAL)
        // Only consider unmatched transactions (those in variance)
        matchedGoalTransactionCode: null,
        // Exclude already linked reversals (but include null/untagged transactions)
        OR: [
          { reviewTag: null },
          { reviewTag: { not: 'REVERSAL_NETTED' as any } },
        ],
        // Exclude Transfer_Reversal and RT Change
        AND: [
          { NOT: { transactionId: { contains: 'Transfer_Reversal' } } },
          { NOT: { transactionId: 'RT Change' } },
        ],
        ...dateFilter,
      },
      include: {
        client: true,
        account: true,
      },
      orderBy: { transactionDate: 'desc' },
    });

    logger.info('Found reversal candidates', {
      sourceTransactionId: transactionId,
      sourceAmount: sourceAmount,
      targetAmount: targetAmount,
      sourceType: sourceTransaction.transactionType,
      oppositeType: oppositeType,
      sourceGoal: sourceTransaction.goalNumber,
      candidateCount: candidates.length,
    });

    return {
      sourceTransaction: {
        id: sourceTransaction.id,
        transactionId: sourceTransaction.transactionId,
        transactionDate: sourceTransaction.transactionDate,
        transactionType: sourceTransaction.transactionType,
        totalAmount: Number(sourceTransaction.totalAmount),
        goalNumber: sourceTransaction.goalNumber,
        clientName: sourceTransaction.client?.clientName,
        accountNumber: sourceTransaction.account?.accountNumber,
        reviewTag: sourceTransaction.reviewTag,
        reviewNotes: sourceTransaction.reviewNotes,
      },
      candidates: candidates.map(c => ({
        id: c.id,
        transactionId: c.transactionId,
        transactionDate: c.transactionDate,
        transactionType: c.transactionType,
        totalAmount: Number(c.totalAmount),
        goalNumber: c.goalNumber,
        clientName: c.client?.clientName,
        accountNumber: c.account?.accountNumber,
        reviewTag: c.reviewTag,
        reviewNotes: c.reviewNotes,
      })),
    };
  }

  /**
   * Link two bank transactions as a reversal pair
   * Both transactions get REVERSAL_NETTED tag and store the paired transaction ID in reviewNotes
   */
  static async linkReversal(
    transactionId1: string,
    transactionId2: string,
    linkedBy: string
  ): Promise<{
    success: boolean;
    message: string;
    transaction1: any;
    transaction2: any;
  }> {
    // Verify both transactions exist
    const txn1 = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId1 },
    });
    const txn2 = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId2 },
    });

    if (!txn1 || !txn2) {
      throw new Error('One or both transactions not found');
    }

    // Validate they're in the same goal
    if (txn1.goalNumber !== txn2.goalNumber) {
      throw new Error(`Transactions must be in the same goal. Found ${txn1.goalNumber} and ${txn2.goalNumber}`);
    }

    // Validate they have opposite transaction types
    if (txn1.transactionType === txn2.transactionType) {
      throw new Error(`Transactions must have opposite types. Both are ${txn1.transactionType}`);
    }

    // Validate amounts sum to zero (one positive, one negative with same absolute value)
    const sum = Number(txn1.totalAmount) + Number(txn2.totalAmount);
    if (Math.abs(sum) > 0.01) { // Allow small tolerance for floating point
      throw new Error(`Amounts must sum to zero. Found ${txn1.totalAmount} + ${txn2.totalAmount} = ${sum}`);
    }

    // Update both transactions
    const now = new Date();
    const [updated1, updated2] = await prisma.$transaction([
      prisma.bankGoalTransaction.update({
        where: { id: transactionId1 },
        data: {
          reviewTag: 'REVERSAL_NETTED' as any, // Type will be valid after Prisma regenerate
          reviewNotes: `Reversal pair with: ${transactionId2}`,
          reviewedBy: linkedBy,
          reviewedAt: now,
          updatedAt: now,
        },
      }),
      prisma.bankGoalTransaction.update({
        where: { id: transactionId2 },
        data: {
          reviewTag: 'REVERSAL_NETTED' as any, // Type will be valid after Prisma regenerate
          reviewNotes: `Reversal pair with: ${transactionId1}`,
          reviewedBy: linkedBy,
          reviewedAt: now,
          updatedAt: now,
        },
      }),
    ]);

    logger.info('Linked reversal pair', {
      transactionId1,
      transactionId2,
      goalNumber: txn1.goalNumber,
      amount: Number(txn1.totalAmount),
      linkedBy,
    });

    return {
      success: true,
      message: `Linked ${txn1.transactionType} and ${txn2.transactionType} as reversal pair (net zero)`,
      transaction1: {
        id: updated1.id,
        transactionId: updated1.transactionId,
        transactionType: updated1.transactionType,
        totalAmount: Number(updated1.totalAmount),
        reviewTag: updated1.reviewTag,
      },
      transaction2: {
        id: updated2.id,
        transactionId: updated2.transactionId,
        transactionType: updated2.transactionType,
        totalAmount: Number(updated2.totalAmount),
        reviewTag: updated2.reviewTag,
      },
    };
  }

  /**
   * Unlink a reversal pair
   * Removes REVERSAL_NETTED tag from both transactions in the pair
   */
  static async unlinkReversal(
    transactionId: string
  ): Promise<{
    success: boolean;
    message: string;
    unlinkedCount: number;
  }> {
    // Find the transaction
    const txn = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!txn) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if ((txn.reviewTag as string) !== 'REVERSAL_NETTED') {
      throw new Error(`Transaction ${transactionId} is not part of a reversal pair`);
    }

    // Extract paired transaction ID from reviewNotes
    const pairedIdMatch = txn.reviewNotes?.match(/Reversal pair with: ([a-f0-9-]+)/);
    const pairedId = pairedIdMatch ? pairedIdMatch[1] : null;

    let unlinkedCount = 0;

    // Unlink this transaction
    await prisma.bankGoalTransaction.update({
      where: { id: transactionId },
      data: {
        reviewTag: null,
        reviewNotes: null,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      },
    });
    unlinkedCount++;

    // Unlink paired transaction if found
    if (pairedId) {
      const paired = await prisma.bankGoalTransaction.findUnique({
        where: { id: pairedId },
      });

      if (paired && (paired.reviewTag as string) === 'REVERSAL_NETTED') {
        await prisma.bankGoalTransaction.update({
          where: { id: pairedId },
          data: {
            reviewTag: null,
            reviewNotes: null,
            reviewedBy: null,
            reviewedAt: null,
            updatedAt: new Date(),
          },
        });
        unlinkedCount++;
      }
    }

    logger.info('Unlinked reversal pair', {
      transactionId,
      pairedId,
      unlinkedCount,
    });

    return {
      success: true,
      message: `Unlinked ${unlinkedCount} transaction(s) from reversal pair`,
      unlinkedCount,
    };
  }

  /**
   * Get reversal pair info for a transaction
   * Returns the paired transaction details if this transaction is part of a reversal pair
   */
  static async getReversalPairInfo(
    transactionId: string
  ): Promise<{
    isReversalPair: boolean;
    pairedTransaction: any | null;
  }> {
    const txn = await prisma.bankGoalTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!txn || (txn.reviewTag as string) !== 'REVERSAL_NETTED') {
      return { isReversalPair: false, pairedTransaction: null };
    }

    // Extract paired transaction ID from reviewNotes
    const pairedIdMatch = txn.reviewNotes?.match(/Reversal pair with: ([a-f0-9-]+)/);
    const pairedId = pairedIdMatch ? pairedIdMatch[1] : null;

    if (!pairedId) {
      return { isReversalPair: true, pairedTransaction: null };
    }

    const paired = await prisma.bankGoalTransaction.findUnique({
      where: { id: pairedId },
      include: { client: true, account: true },
    });

    return {
      isReversalPair: true,
      pairedTransaction: paired ? {
        id: paired.id,
        transactionId: paired.transactionId,
        transactionDate: paired.transactionDate,
        transactionType: paired.transactionType,
        totalAmount: Number(paired.totalAmount),
        goalNumber: paired.goalNumber,
        clientName: paired.client?.clientName,
      } : null,
    };
  }
}

export default SmartMatcher;
