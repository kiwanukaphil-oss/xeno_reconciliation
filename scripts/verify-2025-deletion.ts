import { prisma } from '../src/config/database';

/**
 * Verifies 2025 transaction deletion
 * Run with: npx ts-node scripts/verify-2025-deletion.ts
 */

async function verify2025Deletion() {
  console.log('🔍 Verifying 2025 transaction deletion...\n');

  try {
    // Check fund_transactions table
    const count = await prisma.fundTransaction.count({
      where: {
        transactionDate: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
    });

    console.log(`Fund transactions table: ${count} transactions found`);

    if (count === 0) {
      console.log('✅ Confirmed: No 2025 transactions in database\n');
    } else {
      console.log('⚠️  Warning: Still found 2025 transactions!\n');

      // Show sample transactions
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
          transactionDate: true,
          amount: true,
          fund: {
            select: {
              fundCode: true,
            },
          },
        },
      });

      console.log('Sample transactions still present:');
      console.table(samples);
    }

    // Check total transactions
    const totalCount = await prisma.fundTransaction.count();
    console.log(`Total transactions in database: ${totalCount.toLocaleString()}\n`);

    // Check if there's any cache service
    console.log('💡 Tips to resolve UI cache issues:');
    console.log('   1. Hard refresh browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)');
    console.log('   2. Clear browser cache for localhost');
    console.log('   3. Restart the dev server');
    console.log('   4. Check browser DevTools Network tab for cached responses\n');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
verify2025Deletion()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
