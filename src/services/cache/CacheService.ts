import { connection as redis } from '../../config/queue';
import { logger } from '../../config/logger';

/**
 * Cache Service for Redis operations
 * Provides simple get/set/delete operations with TTL support
 */
export class CacheService {
  /**
   * Get value from cache
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error: any) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null; // Fail gracefully - don't break the app if cache is down
    }
  }

  /**
   * Set value in cache with optional TTL (in seconds)
   */
  static async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await redis.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await redis.set(key, serialized);
      }
      return true;
    } catch (error: any) {
      logger.error(`Cache set error for key ${key}:`, error);
      return false; // Fail gracefully
    }
  }

  /**
   * Delete value from cache
   */
  static async delete(key: string): Promise<boolean> {
    try {
      await redis.del(key);
      return true;
    } catch (error: any) {
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  static async deletePattern(pattern: string): Promise<number> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }
      const deleted = await redis.del(...keys);
      logger.info(`Deleted ${deleted} cache keys matching pattern: ${pattern}`);
      return deleted;
    } catch (error: any) {
      logger.error(`Cache delete pattern error for ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Check if key exists in cache
   */
  static async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error: any) {
      logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get TTL for a key (in seconds)
   */
  static async ttl(key: string): Promise<number> {
    try {
      return await redis.ttl(key);
    } catch (error: any) {
      logger.error(`Cache TTL error for key ${key}:`, error);
      return -1;
    }
  }

  /**
   * Ping Redis to check connection
   */
  static async ping(): Promise<boolean> {
    try {
      const result = await redis.ping();
      return result === 'PONG';
    } catch (error: any) {
      logger.error('Redis ping failed:', error);
      return false;
    }
  }
}

// Cache key constants
export const CacheKeys = {
  FUND_PRICES_LATEST: 'fund:prices:latest',
  UNIT_REGISTRY_SUMMARY: 'unit-registry:summary',
} as const;

// Cache TTL constants (in seconds)
export const CacheTTL = {
  FUND_PRICES: 3600, // 1 hour
  UNIT_REGISTRY_SUMMARY: 300, // 5 minutes
} as const;
