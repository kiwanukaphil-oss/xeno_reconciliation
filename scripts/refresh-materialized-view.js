const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function refreshMaterializedView() {
  try {
    console.log('Refreshing materialized view...');

    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view`;

    console.log('✓ Materialized view refreshed!');

    const count = await prisma.$queryRaw`SELECT COUNT(*) as count FROM goal_transactions_view`;
    console.log(`\nGoal transactions in view: ${count[0].count}`);

    // Show a sample of goal transactions
    const sample = await prisma.$queryRaw`
      SELECT
        "goalTransactionCode",
        "transactionDate",
        "clientName",
        "goalNumber",
        "totalAmount",
        "fundTransactionCount"
      FROM goal_transactions_view
      ORDER BY "transactionDate" DESC
      LIMIT 5
    `;

    console.log('\nSample goal transactions:');
    sample.forEach((tx, i) => {
      console.log(`\n  ${i + 1}. ${tx.goalTransactionCode}`);
      console.log(`     Date: ${tx.transactionDate}`);
      console.log(`     Client: ${tx.clientName}`);
      console.log(`     Goal: ${tx.goalNumber}`);
      console.log(`     Total Amount: ${tx.totalAmount}`);
      console.log(`     Fund Count: ${tx.fundTransactionCount}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

refreshMaterializedView();
