import { prisma } from '../src/config/database';

/**
 * Refreshes all materialized views
 * Run with: npx ts-node scripts/refresh-materialized-views.ts
 */

async function refreshMaterializedViews() {
  console.log('🔄 Refreshing materialized views...\n');

  try {
    // Refresh account_balances_materialized_view
    console.log('Refreshing account_balances_materialized_view...');
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances_materialized_view`;
    console.log('✅ account_balances_materialized_view refreshed\n');

    console.log('✅ All materialized views refreshed successfully!');
  } catch (error) {
    console.error('❌ Error refreshing materialized views:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
refreshMaterializedViews()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
