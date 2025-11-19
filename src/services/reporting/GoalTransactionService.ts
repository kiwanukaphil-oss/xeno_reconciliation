import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { Decimal } from '@prisma/client/runtime/library';
import { GoalTransactionCodeGenerator } from '../fund-upload/calculators/GoalTransactionCodeGenerator';

/**
 * Service for aggregating and reporting on goal transactions
 */

export interface GoalTransactionSummary {
  goalTransactionCode: string;
  transactionDate: Date;
  clientName: string;
  accountNumber: string;
  goalTitle: string;
  goalNumber: string;
  transactionType: string;

  // Total amount across all funds
  totalAmount: number;

  // Individual fund amounts
  XUMMF: number;
  XUBF: number;
  XUDEF: number;
  XUREF: number;

  // Total units across all funds
  totalUnits: number;

  // Fund transaction count
  fundTransactionCount: number;

  // Related IDs
  clientId: string;
  accountId: string;
  goalId: string;
}

export class GoalTransactionService {
  /**
   * Gets goal transactions with aggregated fund amounts
   */
  static async getGoalTransactions(filters: {
    clientId?: string;
    accountId?: string;
    goalId?: string;
    startDate?: Date;
    endDate?: Date;
    transactionType?: string;
    limit?: number;
    offset?: number;
  }): Promise<GoalTransactionSummary[]> {
    logger.info('Getting goal transactions with filters:', filters);

    // Build where clause
    const where: any = {};

    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.goalId) where.goalId = filters.goalId;
    if (filters.transactionType) where.transactionType = filters.transactionType;

    if (filters.startDate || filters.endDate) {
      where.transactionDate = {};
      if (filters.startDate) where.transactionDate.gte = filters.startDate;
      if (filters.endDate) where.transactionDate.lte = filters.endDate;
    }

    // Get fund transactions
    const fundTransactions = await prisma.fundTransaction.findMany({
      where,
      include: {
        client: true,
        account: true,
        goal: true,
        fund: true,
      },
      orderBy: {
        transactionDate: 'desc',
      },
      take: filters.limit,
      skip: filters.offset,
    });

    // Group by goalTransactionCode
    const groups = GoalTransactionCodeGenerator.groupByCode(fundTransactions);

    // Aggregate each group
    const goalTransactions: GoalTransactionSummary[] = [];

    for (const [code, transactions] of groups.entries()) {
      const first = transactions[0];

      const summary: GoalTransactionSummary = {
        goalTransactionCode: code,
        transactionDate: first.transactionDate,
        clientName: first.client.clientName,
        accountNumber: first.account.accountNumber,
        goalTitle: first.goal.goalTitle,
        goalNumber: first.goal.goalNumber,
        transactionType: first.transactionType,

        // Calculate total amount
        totalAmount: transactions
          .reduce((sum, t) => sum.plus(t.amount), new Decimal(0))
          .toNumber(),

        // Calculate individual fund amounts
        XUMMF: this.getFundAmount(transactions, 'XUMMF'),
        XUBF: this.getFundAmount(transactions, 'XUBF'),
        XUDEF: this.getFundAmount(transactions, 'XUDEF'),
        XUREF: this.getFundAmount(transactions, 'XUREF'),

        // Calculate total units
        totalUnits: transactions
          .reduce((sum, t) => sum.plus(t.units), new Decimal(0))
          .toNumber(),

        fundTransactionCount: transactions.length,

        // IDs
        clientId: first.clientId,
        accountId: first.accountId,
        goalId: first.goalId,
      };

      goalTransactions.push(summary);
    }

    return goalTransactions;
  }

  /**
   * Gets a single goal transaction by code
   */
  static async getGoalTransactionByCode(
    goalTransactionCode: string
  ): Promise<GoalTransactionSummary | null> {
    const transactions = await prisma.fundTransaction.findMany({
      where: { goalTransactionCode },
      include: {
        client: true,
        account: true,
        goal: true,
        fund: true,
      },
    });

    if (transactions.length === 0) return null;

    const first = transactions[0];

    return {
      goalTransactionCode,
      transactionDate: first.transactionDate,
      clientName: first.client.clientName,
      accountNumber: first.account.accountNumber,
      goalTitle: first.goal.goalTitle,
      goalNumber: first.goal.goalNumber,
      transactionType: first.transactionType,
      totalAmount: transactions
        .reduce((sum, t) => sum.plus(t.amount), new Decimal(0))
        .toNumber(),
      XUMMF: this.getFundAmount(transactions, 'XUMMF'),
      XUBF: this.getFundAmount(transactions, 'XUBF'),
      XUDEF: this.getFundAmount(transactions, 'XUDEF'),
      XUREF: this.getFundAmount(transactions, 'XUREF'),
      totalUnits: transactions
        .reduce((sum, t) => sum.plus(t.units), new Decimal(0))
        .toNumber(),
      fundTransactionCount: transactions.length,
      clientId: first.clientId,
      accountId: first.accountId,
      goalId: first.goalId,
    };
  }

  /**
   * Gets fund transactions for a specific goal transaction
   */
  static async getFundTransactionsForGoal(goalTransactionCode: string) {
    return await prisma.fundTransaction.findMany({
      where: { goalTransactionCode },
      include: {
        client: true,
        account: true,
        goal: true,
        fund: true,
      },
      orderBy: {
        fund: {
          fundCode: 'asc',
        },
      },
    });
  }

  /**
   * Helper: Get fund amount from transactions
   * Sums ALL transactions for the given fund code (handles duplicates correctly)
   */
  private static getFundAmount(transactions: any[], fundCode: string): number {
    return transactions
      .filter((t) => t.fund.fundCode === fundCode)
      .reduce((sum, t) => sum.plus(t.amount), new Decimal(0))
      .toNumber();
  }

  /**
   * Exports goal transactions to CSV format (matching reference file)
   */
  static async exportGoalTransactionsCSV(filters: {
    clientId?: string;
    accountId?: string;
    goalId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<string> {
    const goalTransactions = await this.getGoalTransactions(filters);

    // Create CSV header
    const headers = [
      'transactionDate',
      'clientName',
      'accountNumber',
      'goalTitle',
      'goalNumber',
      'Amount',
      'XUMMF',
      'XUBF',
      'XUDEF',
      'XUREF',
    ];

    // Create CSV rows
    const rows = goalTransactions.map((gt) => [
      gt.transactionDate.toISOString().split('T')[0], // YYYY-MM-DD
      gt.clientName,
      gt.accountNumber,
      gt.goalTitle,
      gt.goalNumber,
      gt.totalAmount.toFixed(2),
      gt.XUMMF.toFixed(2),
      gt.XUBF.toFixed(2),
      gt.XUDEF.toFixed(2),
      gt.XUREF.toFixed(2),
    ]);

    // Combine into CSV
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    return csv;
  }

  /**
   * Gets goal transaction statistics
   */
  static async getStatistics(filters: {
    clientId?: string;
    accountId?: string;
    goalId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalGoalTransactions: number;
    totalAmount: number;
    totalUnits: number;
    averageAmount: number;
    fundBreakdown: Record<string, { count: number; amount: number; percentage: number }>;
  }> {
    const goalTransactions = await this.getGoalTransactions(filters);

    const totalGoalTransactions = goalTransactions.length;
    const totalAmount = goalTransactions.reduce((sum, gt) => sum + gt.totalAmount, 0);
    const totalUnits = goalTransactions.reduce((sum, gt) => sum + gt.totalUnits, 0);
    const averageAmount = totalGoalTransactions > 0 ? totalAmount / totalGoalTransactions : 0;

    // Fund breakdown
    const fundBreakdown: Record<string, { count: number; amount: number; percentage: number }> =
      {};

    const fundCodes = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];
    for (const code of fundCodes) {
      const amount = goalTransactions.reduce((sum, gt) => sum + (gt as any)[code], 0);
      const count = goalTransactions.filter((gt) => (gt as any)[code] > 0).length;
      const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;

      fundBreakdown[code] = {
        count,
        amount,
        percentage,
      };
    }

    return {
      totalGoalTransactions,
      totalAmount,
      totalUnits,
      averageAmount,
      fundBreakdown,
    };
  }
}
