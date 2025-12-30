import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { UnitRegistryService } from '../unit-registry/UnitRegistryService';

export interface FundPriceData {
  fundCode: string;
  priceDate: Date;
  bidPrice: number;
  midPrice: number;
  offerPrice: number;
  nav?: number;
}

export interface FundPriceUploadResult {
  success: boolean;
  totalRecords: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: Array<{
    row: number;
    error: string;
    data?: any;
  }>;
}

/**
 * Service for managing fund prices
 */
export class FundPriceService {
  /**
   * Upload fund prices (insert or update)
   */
  static async uploadPrices(prices: FundPriceData[]): Promise<FundPriceUploadResult> {
    const result: FundPriceUploadResult = {
      success: false,
      totalRecords: prices.length,
      inserted: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Get all funds
      const funds = await prisma.fund.findMany({
        select: { id: true, fundCode: true },
      });
      const fundMap = new Map(funds.map(f => [f.fundCode, f.id]));

      for (let i = 0; i < prices.length; i++) {
        const price = prices[i];
        const rowNumber = i + 2; // Account for header row

        try {
          // Validate fund exists
          const fundId = fundMap.get(price.fundCode);
          if (!fundId) {
            result.errors.push({
              row: rowNumber,
              error: `Fund code '${price.fundCode}' not found`,
              data: price,
            });
            result.failed++;
            continue;
          }

          // Validate prices
          if (price.bidPrice > price.midPrice || price.midPrice > price.offerPrice) {
            result.errors.push({
              row: rowNumber,
              error: 'Invalid prices: bidPrice must be <= midPrice <= offerPrice',
              data: price,
            });
            result.failed++;
            continue;
          }

          // Check if price already exists
          const existing = await prisma.fundPrice.findUnique({
            where: {
              fundId_priceDate: {
                fundId,
                priceDate: price.priceDate,
              },
            },
          });

          if (existing) {
            // Update existing price
            await prisma.fundPrice.update({
              where: { id: existing.id },
              data: {
                bidPrice: price.bidPrice,
                midPrice: price.midPrice,
                offerPrice: price.offerPrice,
                nav: price.nav,
              },
            });
            result.updated++;
          } else {
            // Insert new price
            await prisma.fundPrice.create({
              data: {
                fundId,
                priceDate: price.priceDate,
                bidPrice: price.bidPrice,
                midPrice: price.midPrice,
                offerPrice: price.offerPrice,
                nav: price.nav,
              },
            });
            result.inserted++;
          }
        } catch (error: any) {
          logger.error(`Error processing row ${rowNumber}:`, error);
          result.errors.push({
            row: rowNumber,
            error: error.message,
            data: price,
          });
          result.failed++;
        }
      }

      result.success = result.failed === 0;

      // Invalidate fund prices cache if any prices were inserted or updated
      if (result.inserted > 0 || result.updated > 0) {
        await UnitRegistryService.invalidatePricesCache();
        logger.info('Fund prices cache invalidated after upload');
      }

      return result;
    } catch (error: any) {
      logger.error('Error uploading fund prices:', error);
      throw error;
    }
  }

  /**
   * Get fund prices with filters
   */
  static async getPrices(filters: {
    fundCode?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}) {
    const { fundCode, startDate, endDate, limit = 100, offset = 0 } = filters;

    const where: any = {};

    if (fundCode) {
      where.fund = { fundCode };
    }

    if (startDate || endDate) {
      where.priceDate = {};
      if (startDate) {
        where.priceDate.gte = startDate;
      }
      if (endDate) {
        where.priceDate.lte = endDate;
      }
    }

    const [prices, total] = await Promise.all([
      prisma.fundPrice.findMany({
        where,
        include: {
          fund: {
            select: {
              fundCode: true,
              fundName: true,
            },
          },
        },
        orderBy: [
          { priceDate: 'desc' },
          { fund: { fundCode: 'asc' } },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.fundPrice.count({ where }),
    ]);

    return {
      prices: prices.map(p => ({
        id: p.id,
        fundCode: p.fund.fundCode,
        fundName: p.fund.fundName,
        priceDate: p.priceDate,
        bidPrice: p.bidPrice.toNumber(),
        midPrice: p.midPrice.toNumber(),
        offerPrice: p.offerPrice.toNumber(),
        nav: p.nav?.toNumber(),
        createdAt: p.createdAt,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Get latest prices for all funds
   */
  static async getLatestPrices() {
    const funds = await prisma.fund.findMany({
      where: { status: 'ACTIVE' },
      include: {
        fundPrices: {
          orderBy: { priceDate: 'desc' },
          take: 1,
        },
      },
      orderBy: { fundCode: 'asc' },
    });

    return funds.map(fund => ({
      fundCode: fund.fundCode,
      fundName: fund.fundName,
      latestPrice: fund.fundPrices[0] ? {
        priceDate: fund.fundPrices[0].priceDate,
        bidPrice: fund.fundPrices[0].bidPrice.toNumber(),
        midPrice: fund.fundPrices[0].midPrice.toNumber(),
        offerPrice: fund.fundPrices[0].offerPrice.toNumber(),
        nav: fund.fundPrices[0].nav?.toNumber(),
      } : null,
    }));
  }

  /**
   * Get price for a specific fund and date
   */
  static async getPriceByFundAndDate(fundCode: string, priceDate: Date) {
    const fund = await prisma.fund.findUnique({
      where: { fundCode },
      include: {
        fundPrices: {
          where: { priceDate },
          take: 1,
        },
      },
    });

    if (!fund || fund.fundPrices.length === 0) {
      return null;
    }

    const price = fund.fundPrices[0];
    return {
      fundCode: fund.fundCode,
      fundName: fund.fundName,
      priceDate: price.priceDate,
      bidPrice: price.bidPrice.toNumber(),
      midPrice: price.midPrice.toNumber(),
      offerPrice: price.offerPrice.toNumber(),
      nav: price.nav?.toNumber(),
    };
  }

  /**
   * Delete fund price
   */
  static async deletePrice(id: string): Promise<void> {
    await prisma.fundPrice.delete({
      where: { id },
    });

    // Invalidate fund prices cache
    await UnitRegistryService.invalidatePricesCache();
    logger.info('Fund prices cache invalidated after deletion');
  }
}
