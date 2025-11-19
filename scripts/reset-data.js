const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetData() {
  try {
    console.log('Starting database reset...\n');

    // Delete in correct order to respect foreign key constraints

    console.log('1. Deleting fund transactions...');
    const deletedTransactions = await prisma.fundTransaction.deleteMany();
    console.log(`   ✓ Deleted ${deletedTransactions.count} fund transactions`);

    console.log('2. Deleting goals...');
    const deletedGoals = await prisma.goal.deleteMany();
    console.log(`   ✓ Deleted ${deletedGoals.count} goals`);

    console.log('3. Deleting accounts...');
    const deletedAccounts = await prisma.account.deleteMany();
    console.log(`   ✓ Deleted ${deletedAccounts.count} accounts`);

    console.log('4. Deleting clients...');
    const deletedClients = await prisma.client.deleteMany();
    console.log(`   ✓ Deleted ${deletedClients.count} clients`);

    console.log('5. Deleting upload batches...');
    const deletedBatches = await prisma.uploadBatch.deleteMany();
    console.log(`   ✓ Deleted ${deletedBatches.count} upload batches`);

    console.log('6. Refreshing materialized view...');
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view`;
    console.log(`   ✓ Materialized view refreshed (now empty)`);

    // Verify counts
    console.log('\n--- Final Counts ---');
    const fundTransactionCount = await prisma.fundTransaction.count();
    const goalCount = await prisma.goal.count();
    const accountCount = await prisma.account.count();
    const clientCount = await prisma.client.count();
    const batchCount = await prisma.uploadBatch.count();
    const fundCount = await prisma.fund.count();
    const validationRuleCount = await prisma.validationRule.count();

    console.log(`Fund Transactions: ${fundTransactionCount}`);
    console.log(`Goals: ${goalCount}`);
    console.log(`Accounts: ${accountCount}`);
    console.log(`Clients: ${clientCount}`);
    console.log(`Upload Batches: ${batchCount}`);
    console.log(`\nKept (not deleted):`);
    console.log(`Funds: ${fundCount} (XUMMF, XUBF, XUDEF, XUREF)`);
    console.log(`Validation Rules: ${validationRuleCount}`);

    console.log('\n✅ Database reset complete! Ready for fresh upload.');

  } catch (error) {
    console.error('Error resetting database:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetData();
