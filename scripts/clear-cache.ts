import { CacheService } from '../src/services/cache/CacheService';

/**
 * Clears all Redis cache
 * Run with: npx ts-node scripts/clear-cache.ts
 */

async function clearCache() {
  console.log('🗑️  Clearing Redis cache...\n');

  try {
    // Check Redis connection
    const isPingSuccessful = await CacheService.ping();
    if (!isPingSuccessful) {
      console.log('⚠️  Redis is not connected. Skipping cache clear.');
      return;
    }

    console.log('✅ Redis connected\n');

    // Clear all cache patterns
    const patterns = [
      'fund:*',
      'unit-registry:*',
      'dashboard:*',
      'transactions:*',
      'goal-transactions:*',
      '*', // Clear all keys
    ];

    let totalDeleted = 0;

    for (const pattern of patterns) {
      console.log(`Clearing pattern: ${pattern}`);
      const deleted = await CacheService.deletePattern(pattern);
      totalDeleted += deleted;
      console.log(`  Deleted ${deleted} keys\n`);
    }

    console.log('='.repeat(60));
    console.log(`✅ Cache cleared successfully!`);
    console.log(`Total keys deleted: ${totalDeleted}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    throw error;
  } finally {
    // Give Redis time to process
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  }
}

// Run the script
clearCache()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
