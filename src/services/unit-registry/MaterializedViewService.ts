import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { CacheService, CacheKeys } from '../cache/CacheService';

/**
 * Service for managing materialized view refreshes
 * Handles all materialized views in the system
 */
export class MaterializedViewService {
  /**
   * Refresh ALL materialized views
   * This should be called:
   * - After bulk transaction uploads
   * - After transaction deletions
   * - After any data modification that affects views
   */
  static async refreshAllViews(): Promise<{
    success: boolean;
    duration: number;
    refreshed: string[];
    failed: string[];
    error?: string;
  }> {
    const startTime = Date.now();
    const refreshed: string[] = [];
    const failed: string[] = [];

    try {
      logger.info('Starting refresh of all materialized views');

      // Refresh goal_transactions_view
      try {
        await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view`;
        refreshed.push('goal_transactions_view');
        logger.info('✅ goal_transactions_view refreshed');
      } catch (error: any) {
        logger.error('❌ Failed to refresh goal_transactions_view:', error);
        failed.push('goal_transactions_view');
      }

      // Refresh account_unit_balances
      try {
        await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY account_unit_balances`;
        refreshed.push('account_unit_balances');
        logger.info('✅ account_unit_balances refreshed');
      } catch (error: any) {
        logger.error('❌ Failed to refresh account_unit_balances:', error);
        failed.push('account_unit_balances');
      }

      const duration = Date.now() - startTime;
      logger.info(`All materialized views refreshed in ${duration}ms (${refreshed.length} succeeded, ${failed.length} failed)`);

      // Invalidate related caches
      await this.invalidateRelatedCaches();

      return {
        success: failed.length === 0,
        duration,
        refreshed,
        failed,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error('Error refreshing materialized views:', error);

      return {
        success: false,
        duration,
        refreshed,
        failed,
        error: error.message,
      };
    }
  }

  /**
   * Refresh the account_unit_balances materialized view
   * This should be called:
   * - Nightly (scheduled job)
   * - After bulk transaction uploads
   * - After transaction deletions
   * - On demand via API
   */
  static async refreshAccountBalances(): Promise<{
    success: boolean;
    duration: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      logger.info('Starting materialized view refresh: account_unit_balances');

      // Refresh the materialized view concurrently (non-blocking)
      // CONCURRENTLY allows queries to continue during refresh
      await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY account_unit_balances`;

      const duration = Date.now() - startTime;
      logger.info(`Materialized view refreshed successfully in ${duration}ms`);

      // Invalidate related caches
      await this.invalidateRelatedCaches();

      return {
        success: true,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error('Error refreshing materialized view:', error);

      return {
        success: false,
        duration,
        error: error.message,
      };
    }
  }

  /**
   * Refresh the goal_transactions_view materialized view
   */
  static async refreshGoalTransactions(): Promise<{
    success: boolean;
    duration: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      logger.info('Starting materialized view refresh: goal_transactions_view');

      await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view`;

      const duration = Date.now() - startTime;
      logger.info(`Materialized view refreshed successfully in ${duration}ms`);

      // Invalidate related caches
      await this.invalidateRelatedCaches();

      return {
        success: true,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error('Error refreshing materialized view:', error);

      return {
        success: false,
        duration,
        error: error.message,
      };
    }
  }

  /**
   * Get materialized view statistics
   */
  static async getViewStats(): Promise<{
    totalAccounts: number;
    accountsWithBalances: number;
    accountsWithZeroBalance: number;
    lastRefreshed: Date | null;
  }> {
    try {
      const stats: any[] = await prisma.$queryRaw`
        SELECT
          COUNT(*) as total_accounts,
          SUM(CASE WHEN total_units > 0 THEN 1 ELSE 0 END) as accounts_with_balances,
          SUM(CASE WHEN total_units = 0 THEN 1 ELSE 0 END) as accounts_with_zero_balance,
          MAX(last_refreshed_at) as last_refreshed
        FROM account_unit_balances
      `;

      if (stats.length === 0) {
        return {
          totalAccounts: 0,
          accountsWithBalances: 0,
          accountsWithZeroBalance: 0,
          lastRefreshed: null,
        };
      }

      const row = stats[0];
      return {
        totalAccounts: Number(row.total_accounts) || 0,
        accountsWithBalances: Number(row.accounts_with_balances) || 0,
        accountsWithZeroBalance: Number(row.accounts_with_zero_balance) || 0,
        lastRefreshed: row.last_refreshed,
      };
    } catch (error: any) {
      logger.error('Error getting view stats:', error);
      throw error;
    }
  }

  /**
   * Check if materialized view needs refresh
   * Returns true if last refresh was more than 24 hours ago
   */
  static async needsRefresh(): Promise<boolean> {
    try {
      const stats = await this.getViewStats();

      if (!stats.lastRefreshed) {
        return true;
      }

      const hoursSinceRefresh =
        (Date.now() - stats.lastRefreshed.getTime()) / (1000 * 60 * 60);

      return hoursSinceRefresh > 24;
    } catch (error: any) {
      logger.error('Error checking refresh status:', error);
      return false;
    }
  }

  /**
   * Invalidate all related caches after materialized view refresh
   */
  private static async invalidateRelatedCaches(): Promise<void> {
    try {
      // Invalidate unit registry summary cache
      await CacheService.delete(CacheKeys.UNIT_REGISTRY_SUMMARY);

      // Could add more cache invalidations here as needed
      logger.info('Related caches invalidated after materialized view refresh');
    } catch (error: any) {
      logger.warn('Error invalidating caches:', error);
      // Don't throw - cache invalidation failure shouldn't fail the refresh
    }
  }

  /**
   * Schedule automatic nightly refresh
   * Call this on server startup to enable automatic refreshes
   */
  static scheduleNightlyRefresh(): NodeJS.Timeout {
    // Calculate milliseconds until next 2 AM
    const now = new Date();
    const next2AM = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      2, // 2 AM
      0,
      0
    );

    const msUntil2AM = next2AM.getTime() - now.getTime();

    logger.info(`Nightly materialized view refresh scheduled for ${next2AM.toISOString()}`);

    // Schedule first refresh at 2 AM
    return setTimeout(async () => {
      await this.refreshAccountBalances();

      // Schedule subsequent refreshes every 24 hours
      setInterval(async () => {
        await this.refreshAccountBalances();
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntil2AM);
  }
}
