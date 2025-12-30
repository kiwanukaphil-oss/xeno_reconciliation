import { prisma } from '../../config/database';
import { logger } from '../../config/logger';

interface CategoryAUM {
  category: string;
  aum: number;
  accountCount: number;
  percentage: number;
}

interface MonthlyTransaction {
  month: string; // YYYY-MM format
  amount: number;
  transactionCount: number;
}

interface DashboardMetrics {
  lastUploadDate: string | null;
  totalAUM: number;
  totalFundedAccounts: number;
  aumByCategory: CategoryAUM[];
  depositsByMonth: MonthlyTransaction[];
  withdrawalsByMonth: MonthlyTransaction[];
  asOfDate: string;
  prices: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
}

export class DashboardService {
  /**
   * Get latest fund prices
   */
  private static async getLatestPrices() {
    const latestPrices = await prisma.$queryRaw<any[]>`
      SELECT
        f."fundCode",
        fp."midPrice" as price,
        fp."priceDate"
      FROM fund_prices fp
      INNER JOIN funds f ON fp."fundId" = f.id
      INNER JOIN (
        SELECT "fundId", MAX("priceDate") as max_date
        FROM fund_prices
        GROUP BY "fundId"
      ) latest ON fp."fundId" = latest."fundId" AND fp."priceDate" = latest.max_date
    `;

    const prices = {
      XUMMF: 0,
      XUBF: 0,
      XUDEF: 0,
      XUREF: 0,
      asOfDate: '',
    };

    latestPrices.forEach((p) => {
      const fundCode = p.fundCode as 'XUMMF' | 'XUBF' | 'XUDEF' | 'XUREF';
      prices[fundCode] = Number(p.price) || 0;
      if (!prices.asOfDate || p.priceDate > prices.asOfDate) {
        prices.asOfDate = p.priceDate.toISOString().split('T')[0];
      }
    });

    return prices;
  }

  /**
   * Get dashboard metrics
   */
  static async getDashboardMetrics(): Promise<DashboardMetrics> {
    try {
      // Get latest prices
      const priceData = await this.getLatestPrices();
      const prices = {
        XUMMF: priceData.XUMMF,
        XUBF: priceData.XUBF,
        XUDEF: priceData.XUDEF,
        XUREF: priceData.XUREF,
      };

      // 1. Last upload date - get the most recent transaction date
      const lastUploadResult = await prisma.$queryRaw<any[]>`
        SELECT MAX("transactionDate") as last_upload
        FROM fund_transactions
      `;
      const lastUploadDate = lastUploadResult[0]?.last_upload
        ? new Date(lastUploadResult[0].last_upload).toISOString()
        : null;

      // 2 & 3. Total AUM and Funded Accounts - use materialized view
      const aumResult = await prisma.$queryRaw<any[]>`
        SELECT
          COUNT(*) as total_accounts,
          SUM(xummf_units * ${prices.XUMMF} +
              xubf_units * ${prices.XUBF} +
              xudef_units * ${prices.XUDEF} +
              xuref_units * ${prices.XUREF}) as total_aum
        FROM account_unit_balances
        WHERE (xummf_units * ${prices.XUMMF} +
               xubf_units * ${prices.XUBF} +
               xudef_units * ${prices.XUDEF} +
               xuref_units * ${prices.XUREF}) >= 5000
      `;

      const totalAUM = Number(aumResult[0]?.total_aum) || 0;
      const totalFundedAccounts = Number(aumResult[0]?.total_accounts) || 0;

      // 4. AUM by Category - with business groupings
      const categoryAUMResults = await prisma.$queryRaw<any[]>`
        SELECT
          CASE
            WHEN aub."accountType"::text = 'PERSONAL' AND aub."accountCategory"::text = 'GENERAL'
              THEN 'Personal'
            WHEN aub."accountType"::text = 'POOLED' AND aub."accountCategory"::text = 'GENERAL'
              THEN 'Corporate'
            WHEN aub."accountCategory"::text = 'INVESTMENT_CLUBS'
              THEN 'Investment Clubs'
            WHEN aub."accountCategory"::text = 'RETIREMENTS_BENEFIT_SCHEME'
              THEN 'Retirement Benefits Schemes'
            WHEN aub."accountCategory"::text = 'SACCO'
              THEN 'SACCO'
            ELSE 'Other'
          END as category,
          COUNT(*) as account_count,
          SUM(aub.xummf_units * ${prices.XUMMF} +
              aub.xubf_units * ${prices.XUBF} +
              aub.xudef_units * ${prices.XUDEF} +
              aub.xuref_units * ${prices.XUREF}) as aum
        FROM account_unit_balances aub
        GROUP BY category
        ORDER BY aum DESC
      `;

      const aumByCategory: CategoryAUM[] = categoryAUMResults.map((row) => {
        const aum = Number(row.aum) || 0;
        return {
          category: row.category,
          aum,
          accountCount: Number(row.account_count) || 0,
          percentage: totalAUM > 0 ? (aum / totalAUM) * 100 : 0,
        };
      });

      // 5. Deposits by Month - last 12 months
      const depositsByMonthResults = await prisma.$queryRaw<any[]>`
        SELECT
          TO_CHAR(ft."transactionDate", 'YYYY-MM') as month,
          SUM(ft.amount) as amount,
          COUNT(*) as transaction_count
        FROM fund_transactions ft
        WHERE ft."transactionType" = 'DEPOSIT'
          AND ft."transactionDate" >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY month
        ORDER BY month DESC
      `;

      const depositsByMonth: MonthlyTransaction[] = depositsByMonthResults.map((row) => ({
        month: row.month,
        amount: Number(row.amount) || 0,
        transactionCount: Number(row.transaction_count) || 0,
      }));

      // 6. Withdrawals by Month - last 12 months
      const withdrawalsByMonthResults = await prisma.$queryRaw<any[]>`
        SELECT
          TO_CHAR(ft."transactionDate", 'YYYY-MM') as month,
          ABS(SUM(ft.amount)) as amount,
          COUNT(*) as transaction_count
        FROM fund_transactions ft
        WHERE ft."transactionType" = 'WITHDRAWAL'
          AND ft."transactionDate" >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY month
        ORDER BY month DESC
      `;

      const withdrawalsByMonth: MonthlyTransaction[] = withdrawalsByMonthResults.map((row) => ({
        month: row.month,
        amount: Number(row.amount) || 0,
        transactionCount: Number(row.transaction_count) || 0,
      }));

      logger.info('Dashboard metrics loaded successfully');

      return {
        lastUploadDate,
        totalAUM,
        totalFundedAccounts,
        aumByCategory,
        depositsByMonth,
        withdrawalsByMonth,
        asOfDate: priceData.asOfDate,
        prices,
      };
    } catch (error: any) {
      logger.error('Error loading dashboard metrics:', error);
      throw error;
    }
  }
}
