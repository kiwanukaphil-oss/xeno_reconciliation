const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixMaterializedViewIndex() {
  try {
    console.log('=== Checking Materialized View Indexes ===\n');

    // Check if the materialized view has a unique index
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'goal_transactions_view'
    `);

    console.log('Current indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
      console.log(`    ${idx.indexdef}`);
    });

    // Check if there's a unique index
    const hasUniqueIndex = indexes.some(idx =>
      idx.indexdef.toLowerCase().includes('unique')
    );

    if (!hasUniqueIndex) {
      console.log('\n❌ No UNIQUE index found!');
      console.log('   REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index.');
      console.log('\nℹ️  Note: goalTransactionCode is NOT unique because multiple transactions');
      console.log('   can have the same code (different rows in the view for different dates).');
      console.log('\n📝 Proposed solution:');
      console.log('   Create a unique index on a combination that IS unique, such as:');
      console.log('   (goalTransactionCode, transactionDate, clientId, accountId, goalId)');

      // Try to create the unique index
      console.log('\n🔧 Creating unique index...');
      try {
        // Drop the old non-unique index first if it exists
        await prisma.$executeRawUnsafe(`
          DROP INDEX IF EXISTS idx_goal_tx_view_code
        `);
        console.log('   ✅ Dropped old non-unique index');

        // Create a unique index on the combination of fields that makes a row unique
        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX idx_goal_tx_view_unique
          ON goal_transactions_view("goalTransactionCode", "transactionDate", "clientId", "accountId", "goalId")
        `);
        console.log('   ✅ Created unique index: idx_goal_tx_view_unique');

        // Create additional indexes for query performance
        await prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS idx_goal_tx_view_date
          ON goal_transactions_view("transactionDate" DESC)
        `);
        console.log('   ✅ Created date index for performance');

        console.log('\n✅ Materialized view indexes fixed successfully!');
        console.log('   REFRESH MATERIALIZED VIEW CONCURRENTLY will now work correctly.');
      } catch (error) {
        console.error('\n❌ Error creating indexes:', error.message);
        throw error;
      }
    } else {
      console.log('\n✅ Unique index already exists. CONCURRENTLY refresh is supported.');
    }

    // Test the refresh
    console.log('\n🧪 Testing REFRESH MATERIALIZED VIEW CONCURRENTLY...');
    try {
      const start = Date.now();
      await prisma.$executeRawUnsafe(`
        REFRESH MATERIALIZED VIEW CONCURRENTLY goal_transactions_view
      `);
      const duration = Date.now() - start;
      console.log(`   ✅ Refresh successful! (${duration}ms)`);
    } catch (error) {
      console.error('   ❌ Refresh failed:', error.message);
      throw error;
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixMaterializedViewIndex();
