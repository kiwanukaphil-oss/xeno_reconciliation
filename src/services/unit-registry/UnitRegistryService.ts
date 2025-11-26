import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';
import { CacheService, CacheKeys, CacheTTL } from '../cache/CacheService';

const prisma = new PrismaClient();

export interface UnitRegistryEntry {
  accountId: string;
  clientName: string;
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  goalCount: number;
  lastTransactionDate: Date | null;
  units: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
  values: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
  totalValue: number;
}

export interface GoalBalance {
  goalId: string;
  goalNumber: string;
  goalTitle: string;
  units: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
  values: {
    XUMMF: number;
    XUBF: number;
    XUDEF: number;
    XUREF: number;
  };
  totalValue: number;
}

export interface UnitRegistryResult {
  entries: UnitRegistryEntry[];
  asOfDate: Date | null;
  prices: {
    XUMMF: number | null;
    XUBF: number | null;
    XUDEF: number | null;
    XUREF: number | null;
  };
  summary: {
    totalClients: number;
    totalUnits: {
      XUMMF: number;
      XUBF: number;
      XUDEF: number;
      XUREF: number;
    };
    totalValues: {
      XUMMF: number;
      XUBF: number;
      XUDEF: number;
      XUREF: number;
    };
    totalValue: number;
  };
  total: number;
  limit: number;
  offset: number;
}

/**
 * Service for managing unit registry and client portfolio positions
 * OPTIMIZED VERSION using raw SQL aggregation
 */
export class UnitRegistryService {
  /**
   * Get unit registry with current positions (OPTIMIZED with Materialized View)
   * Uses pre-aggregated account_unit_balances for 10-100x faster queries
   */
  static async getUnitRegistry(filters: {
    showOnlyFunded?: boolean;
    fundedThreshold?: number;
    search?: string;
    accountType?: string;
    accountCategory?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<UnitRegistryResult> {
    const {
      showOnlyFunded = true, // Default: show only funded accounts
      fundedThreshold = 5000, // Default threshold: 5000 UGX
      search,
      accountType,
      accountCategory,
      limit = 100,
      offset = 0,
      sortBy = 'clientName',
      sortOrder = 'asc',
    } = filters;

    try {
      logger.info('Loading unit registry from materialized view...');

      // Get latest fund prices (cached)
      const latestPrices = await this.getLatestPrices();

      // Build WHERE clause parameters
      const queryParams: any[] = [];
      const conditions: string[] = [];
      let paramIndex = 1;

      // Search filter
      if (search !== undefined && search !== '') {
        conditions.push(`(LOWER(aub."accountNumber") LIKE $${paramIndex} OR LOWER(aub."clientName") LIKE $${paramIndex})`);
        queryParams.push(`%${search.toLowerCase()}%`);
        paramIndex++;
      }

      // Account type filter (cast to text for comparison since it's an enum)
      if (accountType) {
        conditions.push(`aub."accountType"::text = $${paramIndex}`);
        queryParams.push(accountType);
        paramIndex++;
      }

      // Account category filter (cast to text for comparison since it's an enum)
      if (accountCategory) {
        conditions.push(`aub."accountCategory"::text = $${paramIndex}`);
        queryParams.push(accountCategory);
        paramIndex++;
      }

      // Filter by funded accounts (total portfolio value >= threshold)
      if (showOnlyFunded) {
        const totalValueFormula = `(aub.xummf_units * ${latestPrices.XUMMF || 0} + aub.xubf_units * ${latestPrices.XUBF || 0} + aub.xudef_units * ${latestPrices.XUDEF || 0} + aub.xuref_units * ${latestPrices.XUREF || 0})`;
        conditions.push(`${totalValueFormula} >= ${fundedThreshold}`);
      }

      const fullWhereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Map sortBy to database column (with SQL injection protection)
      const sortColumnMap: Record<string, string> = {
        clientName: 'aub."clientName"',
        accountNumber: 'aub."accountNumber"',
        accountType: 'aub."accountType"',
        lastTransactionDate: 'aub.last_transaction_date',
        xummfUnits: 'aub.xummf_units',
        xubfUnits: 'aub.xubf_units',
        xudefUnits: 'aub.xudef_units',
        xurefUnits: 'aub.xuref_units',
        totalUnits: 'aub.total_units',
        // Calculated column for total value (will be calculated at query time if needed)
        totalValue: `(aub.xummf_units * ${latestPrices.XUMMF || 0} + aub.xubf_units * ${latestPrices.XUBF || 0} + aub.xudef_units * ${latestPrices.XUDEF || 0} + aub.xuref_units * ${latestPrices.XUREF || 0})`,
      };

      const sortColumn = sortColumnMap[sortBy] || sortColumnMap.clientName;
      const sortDirection = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const orderByClause = `ORDER BY ${sortColumn} ${sortDirection}`;

      // Get total count for pagination (FAST - no aggregation needed)
      const countQuery = `
        SELECT COUNT(*) as total
        FROM account_unit_balances aub
        ${fullWhereClause}
      `;

      const countResult: any[] = await prisma.$queryRawUnsafe(countQuery, ...queryParams);
      const total = Number(countResult[0]?.total) || 0;

      // Query materialized view (SUPER FAST - data already aggregated)
      const query = `
        SELECT
          aub.account_id as "accountId",
          aub."clientName",
          aub."accountNumber",
          aub."accountType",
          aub."accountCategory",
          aub.last_transaction_date as "lastTransactionDate",
          aub.xummf_units,
          aub.xubf_units,
          aub.xudef_units,
          aub.xuref_units,
          COALESCE((
            SELECT COUNT(*)
            FROM goals g
            WHERE g."accountId" = aub.account_id
          ), 0) as "goalCount"
        FROM account_unit_balances aub
        ${fullWhereClause}
        ${orderByClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      const params = [...queryParams, limit, offset];
      const rawResults: any[] = await prisma.$queryRawUnsafe(query, ...params);

      logger.info(`Loaded ${rawResults.length} account positions from materialized view`);

      // Transform results and calculate values
      const entries: UnitRegistryEntry[] = rawResults.map((row) => {
        const units = {
          XUMMF: Number(row.xummf_units) || 0,
          XUBF: Number(row.xubf_units) || 0,
          XUDEF: Number(row.xudef_units) || 0,
          XUREF: Number(row.xuref_units) || 0,
        };

        const values = {
          XUMMF: units.XUMMF * (latestPrices.XUMMF || 0),
          XUBF: units.XUBF * (latestPrices.XUBF || 0),
          XUDEF: units.XUDEF * (latestPrices.XUDEF || 0),
          XUREF: units.XUREF * (latestPrices.XUREF || 0),
        };

        const totalValue = Object.values(values).reduce((sum, v) => sum + v, 0);

        return {
          accountId: row.accountId,
          clientName: row.clientName,
          accountNumber: row.accountNumber,
          accountType: row.accountType,
          accountCategory: row.accountCategory,
          goalCount: Number(row.goalCount) || 0,
          lastTransactionDate: row.lastTransactionDate,
          units,
          values,
          totalValue,
        };
      });

      // Calculate summary from FULL dataset using materialized view (FAST!)
      const summaryQuery = `
        SELECT
          COUNT(*) as total_accounts,
          COALESCE(SUM(aub.xummf_units), 0) as total_xummf_units,
          COALESCE(SUM(aub.xubf_units), 0) as total_xubf_units,
          COALESCE(SUM(aub.xudef_units), 0) as total_xudef_units,
          COALESCE(SUM(aub.xuref_units), 0) as total_xuref_units
        FROM account_unit_balances aub
        ${fullWhereClause}
      `;

      const summaryResult: any[] = await prisma.$queryRawUnsafe(summaryQuery, ...queryParams);
      const summaryRow = summaryResult[0];

      const totalUnits = {
        XUMMF: Number(summaryRow.total_xummf_units) || 0,
        XUBF: Number(summaryRow.total_xubf_units) || 0,
        XUDEF: Number(summaryRow.total_xudef_units) || 0,
        XUREF: Number(summaryRow.total_xuref_units) || 0,
      };

      const totalValues = {
        XUMMF: totalUnits.XUMMF * (latestPrices.XUMMF || 0),
        XUBF: totalUnits.XUBF * (latestPrices.XUBF || 0),
        XUDEF: totalUnits.XUDEF * (latestPrices.XUDEF || 0),
        XUREF: totalUnits.XUREF * (latestPrices.XUREF || 0),
      };

      const totalValue =
        totalValues.XUMMF +
        totalValues.XUBF +
        totalValues.XUDEF +
        totalValues.XUREF;

      const summary = {
        totalClients: Number(summaryRow.total_accounts) || 0,
        totalUnits,
        totalValues,
        totalValue,
      };

      logger.info('Unit registry loaded successfully from materialized view');

      return {
        entries,
        asOfDate: latestPrices.asOfDate,
        prices: {
          XUMMF: latestPrices.XUMMF,
          XUBF: latestPrices.XUBF,
          XUDEF: latestPrices.XUDEF,
          XUREF: latestPrices.XUREF,
        },
        summary,
        total,
        limit,
        offset,
      };
    } catch (error: any) {
      logger.error('Error getting unit registry:', error);
      throw error;
    }
  }

  /**
   * Get latest mid prices for all funds (OPTIMIZED - single query with caching)
   */
  private static async getLatestPrices(): Promise<{
    XUMMF: number | null;
    XUBF: number | null;
    XUDEF: number | null;
    XUREF: number | null;
    asOfDate: Date | null;
  }> {
    // Try to get from cache first
    const cachedPrices = await CacheService.get<{
      XUMMF: number | null;
      XUBF: number | null;
      XUDEF: number | null;
      XUREF: number | null;
      asOfDate: Date | null;
    }>(CacheKeys.FUND_PRICES_LATEST);

    if (cachedPrices) {
      logger.debug('Fund prices loaded from cache');
      return cachedPrices;
    }

    logger.debug('Fund prices cache miss - fetching from database');

    // Single query to get latest prices for all funds using DISTINCT ON
    const latestPrices: any[] = await prisma.$queryRaw`
      SELECT DISTINCT ON (f."fundCode")
        f."fundCode",
        fp."midPrice",
        fp."priceDate"
      FROM funds f
      LEFT JOIN fund_prices fp ON fp."fundId" = f.id
      WHERE f."fundCode" IN ('XUMMF', 'XUBF', 'XUDEF', 'XUREF')
      ORDER BY f."fundCode", fp."priceDate" DESC NULLS LAST
    `;

    const prices: any = {
      XUMMF: null,
      XUBF: null,
      XUDEF: null,
      XUREF: null,
      asOfDate: null,
    };

    // Transform results
    for (const row of latestPrices) {
      if (row.midPrice) {
        prices[row.fundCode] = Number(row.midPrice);

        // Track the latest price date across all funds
        if (!prices.asOfDate || row.priceDate > prices.asOfDate) {
          prices.asOfDate = row.priceDate;
        }
      }
    }

    // Cache the result
    await CacheService.set(CacheKeys.FUND_PRICES_LATEST, prices, CacheTTL.FUND_PRICES);
    logger.debug(`Fund prices cached for ${CacheTTL.FUND_PRICES} seconds`);

    return prices;
  }

  /**
   * Invalidate fund prices cache (call this when new prices are uploaded)
   */
  static async invalidatePricesCache(): Promise<void> {
    await CacheService.delete(CacheKeys.FUND_PRICES_LATEST);
    logger.info('Fund prices cache invalidated');
  }

  /**
   * Get goal-level breakdown for a specific account
   */
  static async getAccountGoalBreakdown(
    accountId: string
  ): Promise<GoalBalance[]> {
    try {
      // Get fund prices
      const latestPrices = await this.getLatestPrices();

      const query = `
        SELECT
          g.id as "goalId",
          g."goalNumber",
          g."goalTitle",
          COALESCE(SUM(CASE WHEN f."fundCode" = 'XUMMF' THEN ft.units ELSE 0 END), 0) as xummf_units,
          COALESCE(SUM(CASE WHEN f."fundCode" = 'XUBF' THEN ft.units ELSE 0 END), 0) as xubf_units,
          COALESCE(SUM(CASE WHEN f."fundCode" = 'XUDEF' THEN ft.units ELSE 0 END), 0) as xudef_units,
          COALESCE(SUM(CASE WHEN f."fundCode" = 'XUREF' THEN ft.units ELSE 0 END), 0) as xuref_units
        FROM fund_transactions ft
        JOIN goals g ON ft."goalId" = g.id
        JOIN funds f ON ft."fundId" = f.id
        WHERE g."accountId" = $1
        GROUP BY g.id, g."goalNumber", g."goalTitle"
        ORDER BY g."goalNumber"
      `;

      const rawResults: any[] = await prisma.$queryRawUnsafe(query, accountId);

      return rawResults.map((row) => {
        const units = {
          XUMMF: Number(row.xummf_units) || 0,
          XUBF: Number(row.xubf_units) || 0,
          XUDEF: Number(row.xudef_units) || 0,
          XUREF: Number(row.xuref_units) || 0,
        };

        const values = {
          XUMMF: units.XUMMF * (latestPrices.XUMMF || 0),
          XUBF: units.XUBF * (latestPrices.XUBF || 0),
          XUDEF: units.XUDEF * (latestPrices.XUDEF || 0),
          XUREF: units.XUREF * (latestPrices.XUREF || 0),
        };

        const totalValue = Object.values(values).reduce((sum, v) => sum + v, 0);

        return {
          goalId: row.goalId,
          goalNumber: row.goalNumber,
          goalTitle: row.goalTitle,
          units,
          values,
          totalValue,
        };
      });
    } catch (error: any) {
      logger.error(`Error getting goal breakdown for account ${accountId}:`, error);
      throw error;
    }
  }
}

