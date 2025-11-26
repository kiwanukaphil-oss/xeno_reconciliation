import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

interface FundTransactionFilters {
  startDate: string;
  endDate: string;
  search?: string;
  fundCode?: string;
  transactionType?: string;
  accountType?: string;
  accountCategory?: string;
  goalTransactionCode?: string;
  batchId?: string;
  page?: number;
  limit?: number;
}

interface FundTransactionResult {
  data: any[];
  summary: {
    totalRecords: number;
    totalDeposits: number;
    totalWithdrawals: number;
    netCashFlow: number;
    byFund: {
      XUMMF: { deposits: number; withdrawals: number; net: number };
      XUBF: { deposits: number; withdrawals: number; net: number };
      XUDEF: { deposits: number; withdrawals: number; net: number };
      XUREF: { deposits: number; withdrawals: number; net: number };
    };
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class FundTransactionService {
  /**
   * Get fund transactions with filters and pagination
   */
  static async getFundTransactions(
    filters: FundTransactionFilters
  ): Promise<FundTransactionResult> {
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
      page = 1,
      limit = 50,
    } = filters;

    logger.info(`Fetching fund transactions: ${startDate} to ${endDate}, page ${page}`);

    // Build WHERE clause
    const whereClause: any = {
      transactionDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    // Search filter (client name or account number)
    if (search) {
      whereClause.OR = [
        {
          client: {
            clientName: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          account: {
            accountNumber: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    // Fund code filter
    if (fundCode) {
      whereClause.fund = {
        fundCode: fundCode,
      };
    }

    // Transaction type filter
    if (transactionType) {
      whereClause.transactionType = transactionType;
    }

    // Account type filter
    if (accountType) {
      whereClause.account = {
        ...whereClause.account,
        accountType: accountType,
      };
    }

    // Account category filter
    if (accountCategory) {
      whereClause.account = {
        ...whereClause.account,
        accountCategory: accountCategory,
      };
    }

    // Goal transaction code filter
    if (goalTransactionCode) {
      whereClause.goalTransactionCode = goalTransactionCode;
    }

    // Batch ID filter
    if (batchId) {
      whereClause.uploadBatchId = batchId;
    }

    // Get total count (fast with indexes)
    const total = await prisma.fundTransaction.count({ where: whereClause });

    // Get paginated data with relations
    const transactions = await prisma.fundTransaction.findMany({
      where: whereClause,
      include: {
        client: {
          select: {
            clientName: true,
          },
        },
        account: {
          select: {
            accountNumber: true,
            accountType: true,
            accountCategory: true,
          },
        },
        goal: {
          select: {
            goalNumber: true,
            goalTitle: true,
          },
        },
        fund: {
          select: {
            fundCode: true,
            fundName: true,
          },
        },
        uploadBatch: {
          select: {
            batchNumber: true,
          },
        },
      },
      orderBy: [
        { transactionDate: 'desc' },
        { goalTransactionCode: 'asc' },
        { fund: { fundCode: 'asc' } },
      ],
      take: limit,
      skip: (page - 1) * limit,
    });

    // Calculate summary statistics
    const summary = await this.calculateSummary(whereClause);

    // Transform data for frontend
    const transformedData = transactions.map((t) => ({
      id: t.id,
      fundTransactionId: t.fundTransactionId,
      goalTransactionCode: t.goalTransactionCode,
      transactionDate: t.transactionDate,
      clientName: t.client.clientName,
      accountNumber: t.account.accountNumber,
      accountType: t.account.accountType,
      accountCategory: t.account.accountCategory,
      goalNumber: t.goal.goalNumber,
      goalTitle: t.goal.goalTitle,
      fundCode: t.fund.fundCode,
      fundName: t.fund.fundName,
      transactionType: t.transactionType,
      amount: Number(t.amount),
      units: Number(t.units),
      bidPrice: Number(t.bidPrice),
      offerPrice: Number(t.offerPrice),
      midPrice: Number(t.midPrice),
      priceDate: t.priceDate,
      batchNumber: t.uploadBatch.batchNumber,
      reference: t.reference,
      notes: t.notes,
    }));

    logger.info(`Fetched ${transformedData.length} fund transactions`);

    return {
      data: transformedData,
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Calculate summary statistics for filtered transactions
   */
  private static async calculateSummary(whereClause: any) {
    const aggregations = await prisma.fundTransaction.groupBy({
      by: ['transactionType'],
      where: whereClause,
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const byFundAggregations = await prisma.fundTransaction.groupBy({
      by: ['fundId', 'transactionType'],
      where: whereClause,
      _sum: {
        amount: true,
      },
    });

    // Get fund codes mapping
    const funds = await prisma.fund.findMany({
      select: { id: true, fundCode: true },
    });
    const fundMap = new Map(funds.map((f) => [f.id, f.fundCode]));

    // Calculate totals
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let totalRecords = 0;

    aggregations.forEach((agg) => {
      totalRecords += agg._count;
      const amount = Number(agg._sum.amount) || 0;
      if (agg.transactionType === 'DEPOSIT') {
        totalDeposits += amount;
      } else {
        totalWithdrawals += amount;
      }
    });

    // Calculate by fund
    const byFund: any = {
      XUMMF: { deposits: 0, withdrawals: 0, net: 0 },
      XUBF: { deposits: 0, withdrawals: 0, net: 0 },
      XUDEF: { deposits: 0, withdrawals: 0, net: 0 },
      XUREF: { deposits: 0, withdrawals: 0, net: 0 },
    };

    byFundAggregations.forEach((agg) => {
      const fundCode = fundMap.get(agg.fundId);
      if (fundCode && byFund[fundCode]) {
        const amount = Number(agg._sum.amount) || 0;
        if (agg.transactionType === 'DEPOSIT') {
          byFund[fundCode].deposits += amount;
        } else {
          byFund[fundCode].withdrawals += amount;
        }
        byFund[fundCode].net = byFund[fundCode].deposits - byFund[fundCode].withdrawals;
      }
    });

    return {
      totalRecords,
      totalDeposits,
      totalWithdrawals,
      netCashFlow: totalDeposits - totalWithdrawals,
      byFund,
    };
  }

  /**
   * Get summary statistics only (without fetching transactions)
   */
  static async getSummary(filters: Omit<FundTransactionFilters, 'page' | 'limit'>) {
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
    } = filters;

    // Build WHERE clause (same as getFundTransactions)
    const whereClause: any = {
      transactionDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    if (search) {
      whereClause.OR = [
        {
          client: {
            clientName: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          account: {
            accountNumber: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    if (fundCode) {
      whereClause.fund = {
        fundCode: fundCode,
      };
    }

    if (transactionType) {
      whereClause.transactionType = transactionType;
    }

    if (accountType) {
      whereClause.account = {
        ...whereClause.account,
        accountType: accountType,
      };
    }

    if (accountCategory) {
      whereClause.account = {
        ...whereClause.account,
        accountCategory: accountCategory,
      };
    }

    if (goalTransactionCode) {
      whereClause.goalTransactionCode = goalTransactionCode;
    }

    if (batchId) {
      whereClause.uploadBatchId = batchId;
    }

    return await this.calculateSummary(whereClause);
  }

  /**
   * Get a single fund transaction by ID
   */
  static async getById(id: string) {
    const transaction = await prisma.fundTransaction.findUnique({
      where: { id },
      include: {
        client: true,
        account: true,
        goal: true,
        fund: true,
        uploadBatch: {
          select: {
            batchNumber: true,
            fileName: true,
            uploadedAt: true,
          },
        },
      },
    });

    if (!transaction) {
      return null;
    }

    return {
      ...transaction,
      amount: Number(transaction.amount),
      units: Number(transaction.units),
      bidPrice: Number(transaction.bidPrice),
      offerPrice: Number(transaction.offerPrice),
      midPrice: Number(transaction.midPrice),
    };
  }
}
