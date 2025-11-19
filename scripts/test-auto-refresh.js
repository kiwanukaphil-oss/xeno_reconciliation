const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function testRefresh() {
  try {
    console.log('Testing materialized view refresh...\n');

    // Check count before refresh
    const countBefore = await prisma.$queryRaw`SELECT COUNT(*) as count FROM goal_transactions_view`;
    console.log(`Goal transactions BEFORE refresh: ${countBefore[0].count}`);

    // Attempt refresh
    console.log('\nAttempting to refresh materialized view...');
    await prisma.$executeRawUnsafe(`
      REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view
    `);
    console.log('✓ Refresh command executed successfully');

    // Check count after refresh
    const countAfter = await prisma.$queryRaw`SELECT COUNT(*) as count FROM goal_transactions_view`;
    console.log(`\nGoal transactions AFTER refresh: ${countAfter[0].count}`);

    console.log('\n✅ Test completed successfully');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testRefresh();
