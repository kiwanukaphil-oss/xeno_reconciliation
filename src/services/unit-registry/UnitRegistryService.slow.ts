import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

const prisma = new PrismaClient();

export interface UnitRegistryEntry {
  clientName: string;
  accountNumber: string;
  accountType: string;
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
    totalValue: number;
  };
}

/**
 * Service for managing unit registry and client portfolio positions
 */
export class UnitRegistryService {
  private static readonly FUND_CODES = ['XUMMF', 'XUBF', 'XUDEF', 'XUREF'];

  /**
   * Get unit registry with current positions
   */
  static async getUnitRegistry(filters: {
    includeZeroBalances?: boolean;
    search?: string;
  } = {}): Promise<UnitRegistryResult> {
    const { includeZeroBalances = false, search } = filters;

    try {
      // Get latest fund prices
      const latestPrices = await this.getLatestPrices();

      // Get all accounts with their fund transactions
      const accounts = await prisma.account.findMany({
        where: search ? {
          OR: [
            { accountNumber: { contains: search, mode: 'insensitive' } },
            { client: { clientName: { contains: search, mode: 'insensitive' } } },
          ],
        } : undefined,
        include: {
          client: {
            select: {
              clientName: true,
            },
          },
          fundTransactions: {
            include: {
              fund: {
                select: {
                  fundCode: true,
                },
              },
            },
          },
        },
        orderBy: [
          { client: { clientName: 'asc' } },
          { accountNumber: 'asc' },
        ],
      });

      // Calculate unit balances and values for each account
      const entries: UnitRegistryEntry[] = [];

      for (const account of accounts) {
        // Calculate units per fund
        const units = {
          XUMMF: 0,
          XUBF: 0,
          XUDEF: 0,
          XUREF: 0,
        };

        let lastTransactionDate: Date | null = null;

        for (const transaction of account.fundTransactions) {
          const fundCode = transaction.fund.fundCode as keyof typeof units;
          if (fundCode in units) {
            // Add units (deposits are positive, withdrawals are negative based on transaction type)
            units[fundCode] += transaction.units.toNumber();

            // Track latest transaction date
            if (!lastTransactionDate || transaction.transactionDate > lastTransactionDate) {
              lastTransactionDate = transaction.transactionDate;
            }
          }
        }

        // Calculate total units across all funds
        const totalUnits = Object.values(units).reduce((sum, u) => sum + u, 0);

        // Skip zero balance accounts if requested
        if (!includeZeroBalances && totalUnits === 0) {
          continue;
        }

        // Calculate values using latest prices
        const values = {
          XUMMF: units.XUMMF * (latestPrices.XUMMF || 0),
          XUBF: units.XUBF * (latestPrices.XUBF || 0),
          XUDEF: units.XUDEF * (latestPrices.XUDEF || 0),
          XUREF: units.XUREF * (latestPrices.XUREF || 0),
        };

        const totalValue = Object.values(values).reduce((sum, v) => sum + v, 0);

        entries.push({
          clientName: account.client.clientName,
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          lastTransactionDate,
          units,
          values,
          totalValue,
        });
      }

      // Calculate summary
      const summary = {
        totalClients: entries.length,
        totalUnits: {
          XUMMF: entries.reduce((sum, e) => sum + e.units.XUMMF, 0),
          XUBF: entries.reduce((sum, e) => sum + e.units.XUBF, 0),
          XUDEF: entries.reduce((sum, e) => sum + e.units.XUDEF, 0),
          XUREF: entries.reduce((sum, e) => sum + e.units.XUREF, 0),
        },
        totalValue: entries.reduce((sum, e) => sum + e.totalValue, 0),
      };

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
      };
    } catch (error: any) {
      logger.error('Error getting unit registry:', error);
      throw error;
    }
  }

  /**
   * Get latest mid prices for all funds
   */
  private static async getLatestPrices(): Promise<{
    XUMMF: number | null;
    XUBF: number | null;
    XUDEF: number | null;
    XUREF: number | null;
    asOfDate: Date | null;
  }> {
    const prices: any = {
      XUMMF: null,
      XUBF: null,
      XUDEF: null,
      XUREF: null,
      asOfDate: null,
    };

    for (const fundCode of this.FUND_CODES) {
      const fund = await prisma.fund.findUnique({
        where: { fundCode },
        include: {
          fundPrices: {
            orderBy: { priceDate: 'desc' },
            take: 1,
          },
        },
      });

      if (fund && fund.fundPrices.length > 0) {
        const latestPrice = fund.fundPrices[0];
        prices[fundCode] = latestPrice.midPrice.toNumber();

        // Track the latest price date
        if (!prices.asOfDate || latestPrice.priceDate > prices.asOfDate) {
          prices.asOfDate = latestPrice.priceDate;
        }
      }
    }

    return prices;
  }
}
