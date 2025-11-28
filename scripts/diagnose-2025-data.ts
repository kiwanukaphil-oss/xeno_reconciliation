import { prisma } from '../src/config/database';

/**
 * Comprehensive diagnostic for 2025 data
 * Run with: npx ts-node scripts/diagnose-2025-data.ts
 */

async function diagnose2025Data() {
  console.log('🔍 COMPREHENSIVE 2025 DATA DIAGNOSTIC\n');
  console.log('='.repeat(80));

  try {
    // 1. Direct count from fund_transactions table
    console.log('\n1️⃣  FUND_TRANSACTIONS TABLE:');
    console.log('-'.repeat(80));

    const directCount = await prisma.$queryRaw<Array<{count: bigint}>>`
      SELECT COUNT(*) as count
      FROM fund_transactions
      WHERE "transactionDate" >= '2025-01-01'::date
        AND "transactionDate" < '2026-01-01'::date
    `;
    console.log(`Direct SQL count: ${directCount[0].count}`);

    const prismaCount = await prisma.fundTransaction.count({
      where: {
        transactionDate: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
    });
    console.log(`Prisma count: ${prismaCount}`);

    // 2. Check for any 2025 data at all (sample)
    console.log('\n2️⃣  SAMPLE 2025 TRANSACTIONS (if any):');
    console.log('-'.repeat(80));

    const samples = await prisma.fundTransaction.findMany({
      where: {
        transactionDate: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
      take: 5,
      select: {
        id: true,
        fundTransactionId: true,
        transactionDate: true,
        amount: true,
        fund: { select: { fundCode: true } },
        client: { select: { clientName: true } },
      },
    });

    if (samples.length === 0) {
      console.log('✅ No 2025 transactions found');
    } else {
      console.log(`⚠️  Found ${samples.length} sample transactions:`);
      console.table(samples);
    }

    // 3. Check all tables that might contain transaction data
    console.log('\n3️⃣  CHECKING OTHER TABLES:');
    console.log('-'.repeat(80));

    // Check upload batches
    const batches2025 = await prisma.$queryRaw<Array<{count: bigint}>>`
      SELECT COUNT(*) as count
      FROM upload_batches
      WHERE "uploadedAt" >= '2025-01-01'::timestamp
        AND "uploadedAt" < '2026-01-01'::timestamp
    `;
    console.log(`Upload batches from 2025: ${batches2025[0].count}`);

    // Check invalid transactions
    const invalidCount = await prisma.invalidFundTransaction.count();
    console.log(`Total invalid transactions: ${invalidCount}`);

    // 4. Check database name
    console.log('\n4️⃣  DATABASE CONNECTION:');
    console.log('-'.repeat(80));

    const dbInfo = await prisma.$queryRaw<Array<{current_database: string}>>`
      SELECT current_database()
    `;
    console.log(`Connected to database: ${dbInfo[0].current_database}`);

    // 5. Check for views or materialized views
    console.log('\n5️⃣  VIEWS AND MATERIALIZED VIEWS:');
    console.log('-'.repeat(80));

    const views = await prisma.$queryRaw<Array<{
      schemaname: string;
      viewname: string;
      definition: string;
    }>>`
      SELECT schemaname, viewname, definition
      FROM pg_views
      WHERE schemaname = 'public'
    `;
    console.log(`Found ${views.length} views:`);
    views.forEach(v => console.log(`  - ${v.viewname}`));

    const matViews = await prisma.$queryRaw<Array<{
      schemaname: string;
      matviewname: string;
    }>>`
      SELECT schemaname, matviewname
      FROM pg_matviews
      WHERE schemaname = 'public'
    `;
    console.log(`\nFound ${matViews.length} materialized views:`);
    matViews.forEach(v => console.log(`  - ${v.matviewname}`));

    // 6. Transaction distribution by year
    console.log('\n6️⃣  TRANSACTION DISTRIBUTION BY YEAR:');
    console.log('-'.repeat(80));

    const yearDistribution = await prisma.$queryRaw<Array<{
      year: number;
      count: bigint;
    }>>`
      SELECT
        EXTRACT(YEAR FROM "transactionDate")::int as year,
        COUNT(*) as count
      FROM fund_transactions
      GROUP BY year
      ORDER BY year
    `;

    yearDistribution.forEach(row => {
      console.log(`${row.year}: ${row.count.toLocaleString()} transactions`);
    });

    // 7. Check if there's data in a date range near 2025
    console.log('\n7️⃣  CHECKING DATE BOUNDARIES:');
    console.log('-'.repeat(80));

    const latestTransaction = await prisma.fundTransaction.findFirst({
      orderBy: { transactionDate: 'desc' },
      select: { transactionDate: true, fund: { select: { fundCode: true } } },
    });

    if (latestTransaction) {
      console.log(`Latest transaction date: ${latestTransaction.transactionDate.toISOString().split('T')[0]}`);
    }

    const earliestTransaction = await prisma.fundTransaction.findFirst({
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true, fund: { select: { fundCode: true } } },
    });

    if (earliestTransaction) {
      console.log(`Earliest transaction date: ${earliestTransaction.transactionDate.toISOString().split('T')[0]}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ DIAGNOSTIC COMPLETE\n');

  } catch (error) {
    console.error('❌ Error during diagnostic:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
diagnose2025Data()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
