import { PrismaClient, ReconciliationStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Tolerance settings
const AMOUNT_TOLERANCE_PERCENT = 0.01; // 1%
const AMOUNT_TOLERANCE_MIN = 1000; // 1000 UGX minimum
const DATE_WINDOW_DAYS = 30;

interface MatchResult {
  bankIds: string[];
  fundIds: string[];
  matchType: 'EXACT' | 'AMOUNT' | 'SPLIT_BANK_TO_FUND' | 'SPLIT_FUND_TO_BANK';
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
  status: 'MATCHED' | 'VARIANCE';
  hasVariance: boolean;
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
  status: 'MATCHED' | 'VARIANCE';
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
      status?: 'ALL' | 'MATCHED' | 'VARIANCE';
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
    const query = `
      WITH bank_summary AS (
        SELECT
          b."goalNumber",
          b."transactionType",
          SUM(b."totalAmount") as total_amount,
          COUNT(*) as txn_count
        FROM bank_goal_transactions b
        WHERE b."transactionDate"::date >= $1::date AND b."transactionDate"::date <= $2::date
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
        COALESCE(gtw.txn_count, 0)::int as "withdrawalGoalTxnCount"
      FROM goal_info gi
      LEFT JOIN bank_summary bd ON bd."goalNumber" = gi."goalNumber" AND bd."transactionType" = 'DEPOSIT'
      LEFT JOIN bank_summary bw ON bw."goalNumber" = gi."goalNumber" AND bw."transactionType" = 'WITHDRAWAL'
      LEFT JOIN goal_txn_summary gtd ON gtd."goalNumber" = gi."goalNumber" AND gtd."transactionType" = 'DEPOSIT'
      LEFT JOIN goal_txn_summary gtw ON gtw."goalNumber" = gi."goalNumber" AND gtw."transactionType" = 'WITHDRAWAL'
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
        status: hasVariance ? 'VARIANCE' : 'MATCHED',
        hasVariance,
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
      status?: 'ALL' | 'MATCHED' | 'VARIANCE';
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
    const bankTxns = await prisma.bankGoalTransaction.findMany({
      where: {
        goalNumber,
        transactionDate: { gte: startDate, lte: endDate },
        ...(transactionType && { transactionType }),
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

    // Group fund transactions by goalTransactionCode to get goal transactions
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
    }>();
    for (const ft of fundTxns) {
      const code = ft.goalTransactionCode;
      if (!goalTxnByCode.has(code)) {
        goalTxnByCode.set(code, {
          ids: [],
          total: 0,
          date: ft.transactionDate,
          transactionId: ft.transactionId,
          type: ft.transactionType,
          xummf: 0,
          xubf: 0,
          xudef: 0,
          xuref: 0,
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
    }

    // Run matching algorithm
    const matches: MatchResult[] = [];
    const matchedBankIds = new Set<string>();
    const matchedFundIds = new Set<string>();

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
    const goalTransactions: GoalTransaction[] = Array.from(goalTxnByCode.entries()).map(
      ([code, group]) => ({
        goalTransactionCode: code,
        transactionDate: group.date,
        transactionId: group.transactionId,
        transactionType: group.type,
        totalAmount: group.total,
        xummfAmount: group.xummf,
        xubfAmount: group.xubf,
        xudefAmount: group.xudef,
        xurefAmount: group.xuref,
        fundTransactionIds: group.ids,
      })
    );

    // Determine unmatched goal transactions (by goalTransactionCode)
    const matchedGoalTxnCodes = new Set<string>();
    for (const match of matches) {
      // Find which goal transaction codes are matched based on their fund transaction IDs
      for (const [code, group] of goalTxnByCode.entries()) {
        if (group.ids.some((id: string) => match.fundIds.includes(id))) {
          matchedGoalTxnCodes.add(code);
        }
      }
    }

    return {
      bankTransactions: bankTxns,
      goalTransactions,
      matches,
      unmatchedBank: bankTxns.filter(b => !matchedBankIds.has(b.id)).map(b => b.id),
      unmatchedGoalTxn: goalTransactions
        .filter(gt => !matchedGoalTxnCodes.has(gt.goalTransactionCode))
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
      // Update bank transaction statuses
      await prisma.bankGoalTransaction.updateMany({
        where: { id: { in: match.bankIds } },
        data: {
          reconciliationStatus: ReconciliationStatus.MATCHED,
          updatedAt: new Date(),
        },
      });
      updated += match.bankIds.length;
    }

    return { updated };
  }
}

export default SmartMatcher;
