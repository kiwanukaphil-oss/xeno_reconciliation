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
    asOfDate?: string;
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
      asOfDate,
      limit = 100,
      offset = 0,
      sortBy = 'clientName',
      sortOrder = 'asc',
    } = filters;

    try {
      // If asOfDate is provided, we need to calculate balances from fund_transactions
      // instead of using the materialized view (which has all-time totals)
      if (asOfDate) {
        logger.info(`Loading unit registry as of date: ${asOfDate}`);
        return await this.getUnitRegistryAsOfDate(asOfDate, filters);
      }

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
   * Get unit registry as of a specific date (calculates from fund_transactions)
   */
  private static async getUnitRegistryAsOfDate(
    asOfDate: string,
    filters: {
      showOnlyFunded?: boolean;
      fundedThreshold?: number;
      search?: string;
      accountType?: string;
      accountCategory?: string;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<UnitRegistryResult> {
    const {
      showOnlyFunded = true,
      fundedThreshold = 5000,
      search,
      accountType,
      accountCategory,
      limit = 100,
      offset = 0,
      sortBy = 'clientName',
      sortOrder = 'asc',
    } = filters;

    // Get prices as of the specified date
    const prices = await this.getLatestPrices(asOfDate);

    // Build WHERE clause for filtering
    const queryParams: any[] = [asOfDate]; // First parameter is always the asOfDate
    const conditions: string[] = ['ft."transactionDate" <= $1::date'];
    let paramIndex = 2;

    // Search filter
    if (search !== undefined && search !== '') {
      conditions.push(`(LOWER(a."accountNumber") LIKE $${paramIndex} OR LOWER(c."clientName") LIKE $${paramIndex})`);
      queryParams.push(`%${search.toLowerCase()}%`);
      paramIndex++;
    }

    // Account type filter
    if (accountType) {
      conditions.push(`a."accountType"::text = $${paramIndex}`);
      queryParams.push(accountType);
      paramIndex++;
    }

    // Account category filter
    if (accountCategory) {
      conditions.push(`a."accountCategory"::text = $${paramIndex}`);
      queryParams.push(accountCategory);
      paramIndex++;
    }

    const fullWhereClause = conditions.join(' AND ');

    // Calculate balances from fund_transactions up to the specified date
    const query = `
      SELECT
        a.id as "accountId",
        c."clientName" as "clientName",
        a."accountNumber",
        a."accountType",
        a."accountCategory",
        MAX(ft."transactionDate") as "lastTransactionDate",
        COALESCE(SUM(CASE WHEN f."fundCode" = 'XUMMF' THEN ft.units ELSE 0 END), 0) as xummf_units,
        COALESCE(SUM(CASE WHEN f."fundCode" = 'XUBF' THEN ft.units ELSE 0 END), 0) as xubf_units,
        COALESCE(SUM(CASE WHEN f."fundCode" = 'XUDEF' THEN ft.units ELSE 0 END), 0) as xudef_units,
        COALESCE(SUM(CASE WHEN f."fundCode" = 'XUREF' THEN ft.units ELSE 0 END), 0) as xuref_units,
        COALESCE((
          SELECT COUNT(*)
          FROM goals g
          WHERE g."accountId" = a.id
        ), 0) as "goalCount"
      FROM fund_transactions ft
      JOIN goals g ON ft."goalId" = g.id
      JOIN accounts a ON g."accountId" = a.id
      JOIN clients c ON a."clientId" = c.id
      JOIN funds f ON ft."fundId" = f.id
      WHERE ${fullWhereClause}
      GROUP BY a.id, c."clientName", a."accountNumber", a."accountType", a."accountCategory"
    `;

    // Get total value for each account to apply funded filter
    const allResults: any[] = await prisma.$queryRawUnsafe(query, ...queryParams);

    // Apply funded filter and transform results
    let filteredResults = allResults;
    if (showOnlyFunded) {
      filteredResults = allResults.filter((row) => {
        const units = {
          XUMMF: Number(row.xummf_units) || 0,
          XUBF: Number(row.xubf_units) || 0,
          XUDEF: Number(row.xudef_units) || 0,
          XUREF: Number(row.xuref_units) || 0,
        };
        const totalValue =
          units.XUMMF * (prices.XUMMF || 0) +
          units.XUBF * (prices.XUBF || 0) +
          units.XUDEF * (prices.XUDEF || 0) +
          units.XUREF * (prices.XUREF || 0);
        return totalValue >= fundedThreshold;
      });
    }

    const total = filteredResults.length;

    // Sort
    const sortedResults = [...filteredResults].sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortBy === 'clientName') {
        aVal = a.clientName;
        bVal = b.clientName;
      } else if (sortBy === 'accountNumber') {
        aVal = a.accountNumber;
        bVal = b.accountNumber;
      } else if (sortBy === 'totalValue') {
        aVal =
          Number(a.xummf_units) * (prices.XUMMF || 0) +
          Number(a.xubf_units) * (prices.XUBF || 0) +
          Number(a.xudef_units) * (prices.XUDEF || 0) +
          Number(a.xuref_units) * (prices.XUREF || 0);
        bVal =
          Number(b.xummf_units) * (prices.XUMMF || 0) +
          Number(b.xubf_units) * (prices.XUBF || 0) +
          Number(b.xudef_units) * (prices.XUDEF || 0) +
          Number(b.xuref_units) * (prices.XUREF || 0);
      }

      if (typeof aVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });

    // Paginate
    const paginatedResults = sortedResults.slice(offset, offset + limit);

    // Transform to entries
    const entries: UnitRegistryEntry[] = paginatedResults.map((row) => {
      const units = {
        XUMMF: Number(row.xummf_units) || 0,
        XUBF: Number(row.xubf_units) || 0,
        XUDEF: Number(row.xudef_units) || 0,
        XUREF: Number(row.xuref_units) || 0,
      };

      const values = {
        XUMMF: units.XUMMF * (prices.XUMMF || 0),
        XUBF: units.XUBF * (prices.XUBF || 0),
        XUDEF: units.XUDEF * (prices.XUDEF || 0),
        XUREF: units.XUREF * (prices.XUREF || 0),
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

    // Calculate summary from all filtered results
    const totalUnits = {
      XUMMF: filteredResults.reduce((sum, r) => sum + Number(r.xummf_units), 0),
      XUBF: filteredResults.reduce((sum, r) => sum + Number(r.xubf_units), 0),
      XUDEF: filteredResults.reduce((sum, r) => sum + Number(r.xudef_units), 0),
      XUREF: filteredResults.reduce((sum, r) => sum + Number(r.xuref_units), 0),
    };

    const totalValues = {
      XUMMF: totalUnits.XUMMF * (prices.XUMMF || 0),
      XUBF: totalUnits.XUBF * (prices.XUBF || 0),
      XUDEF: totalUnits.XUDEF * (prices.XUDEF || 0),
      XUREF: totalUnits.XUREF * (prices.XUREF || 0),
    };

    const totalValue = Object.values(totalValues).reduce((sum, v) => sum + v, 0);

    const summary = {
      totalClients: filteredResults.length,
      totalUnits,
      totalValues,
      totalValue,
    };

    logger.info(`Unit registry loaded as of ${asOfDate}: ${entries.length} entries`);

    return {
      entries,
      asOfDate: prices.asOfDate,
      prices: {
        XUMMF: prices.XUMMF,
        XUBF: prices.XUBF,
        XUDEF: prices.XUDEF,
        XUREF: prices.XUREF,
      },
      summary,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get latest mid prices for all funds (OPTIMIZED - single query with caching)
   * If asOfDate is provided, gets prices as of that date
   */
  private static async getLatestPrices(asOfDate?: string): Promise<{
    XUMMF: number | null;
    XUBF: number | null;
    XUDEF: number | null;
    XUREF: number | null;
    asOfDate: Date | null;
  }> {
    // If asOfDate is provided, skip cache and fetch prices as of that date
    if (asOfDate) {
      logger.debug(`Fetching fund prices as of ${asOfDate}`);

      const pricesAsOfDate: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT DISTINCT ON (f."fundCode")
          f."fundCode",
          fp."midPrice",
          fp."priceDate"
        FROM funds f
        LEFT JOIN fund_prices fp ON fp."fundId" = f.id
        WHERE f."fundCode" IN ('XUMMF', 'XUBF', 'XUDEF', 'XUREF')
          AND fp."priceDate" <= $1::date
        ORDER BY f."fundCode", fp."priceDate" DESC NULLS LAST
      `,
        asOfDate
      );

      const prices: any = {
        XUMMF: null,
        XUBF: null,
        XUDEF: null,
        XUREF: null,
        asOfDate: null,
      };

      // Transform results
      for (const row of pricesAsOfDate) {
        if (row.midPrice) {
          prices[row.fundCode] = Number(row.midPrice);

          // Track the latest price date across all funds
          if (!prices.asOfDate || row.priceDate > prices.asOfDate) {
            prices.asOfDate = row.priceDate;
          }
        }
      }

      return prices;
    }

    // Try to get from cache first (for latest prices only)
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
    accountId: string,
    asOfDate?: string
  ): Promise<GoalBalance[]> {
    try {
      // Get fund prices (as of date if specified)
      const latestPrices = await this.getLatestPrices(asOfDate);

      // Build query with optional date filter
      const query = asOfDate
        ? `
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
          AND ft."transactionDate" <= $2::date
        GROUP BY g.id, g."goalNumber", g."goalTitle"
        ORDER BY g."goalNumber"
      `
        : `
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

      const rawResults: any[] = asOfDate
        ? await prisma.$queryRawUnsafe(query, accountId, asOfDate)
        : await prisma.$queryRawUnsafe(query, accountId);

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

