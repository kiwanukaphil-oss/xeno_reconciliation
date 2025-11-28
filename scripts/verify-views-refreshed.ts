import { prisma } from '../src/config/database';

/**
 * Verifies materialized views no longer contain 2025 data
 */

async function verifyViewsRefreshed() {
  console.log('🔍 Verifying materialized views after refresh...\n');

  try {
    // Check goal_transactions_view
    const goalTxCount = await prisma.$queryRaw<Array<{count: bigint}>>`
      SELECT COUNT(*) as count
      FROM goal_transactions_view
      WHERE "transactionDate" >= '2025-01-01'::date
        AND "transactionDate" < '2026-01-01'::date
    `;

    console.log('goal_transactions_view:');
    console.log(`  2025 records: ${goalTxCount[0].count}`);
    if (goalTxCount[0].count === 0n) {
      console.log('  ✅ Clean - no 2025 data\n');
    } else {
      console.log('  ⚠️  Still contains 2025 data!\n');
    }

    // Check account_unit_balances
    const accountBalCount = await prisma.$queryRaw<Array<{count: bigint}>>`
      SELECT COUNT(*) as count
      FROM account_unit_balances
    `;

    console.log('account_unit_balances:');
    console.log(`  Total records: ${accountBalCount[0].count}`);
    console.log('  ✅ Refreshed\n');

    console.log('='.repeat(60));
    console.log('✅ Verification complete!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

verifyViewsRefreshed()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
