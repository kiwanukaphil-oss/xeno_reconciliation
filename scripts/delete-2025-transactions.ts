import { prisma } from '../src/config/database';

/**
 * Script to delete all 2025 fund transactions
 * Run with: npx ts-node scripts/delete-2025-transactions.ts
 */

async function delete2025Transactions() {
  console.log('='.repeat(80));
  console.log('DELETE 2025 TRANSACTIONS');
  console.log('='.repeat(80));
  console.log();

  try {
    // Step 1: Get statistics BEFORE deletion
    console.log('📊 Analyzing 2025 transactions...\n');

    const transactions2025 = await prisma.fundTransaction.findMany({
      where: {
        transactionDate: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
      select: {
        id: true,
        transactionDate: true,
        transactionType: true,
        amount: true,
        fundId: true,
        fund: {
          select: {
            fundCode: true,
          },
        },
      },
    });

    const count = transactions2025.length;

    if (count === 0) {
      console.log('✅ No 2025 transactions found. Nothing to delete.');
      return;
    }

    // Calculate statistics
    const depositCount = transactions2025.filter(t => t.transactionType === 'DEPOSIT').length;
    const withdrawalCount = transactions2025.filter(t => t.transactionType === 'WITHDRAWAL').length;
    const totalAmount = transactions2025.reduce((sum, t) => sum + Number(t.amount), 0);

    // Fund breakdown
    const fundBreakdown: Record<string, number> = {};
    transactions2025.forEach(t => {
      const fundCode = t.fund.fundCode;
      fundBreakdown[fundCode] = (fundBreakdown[fundCode] || 0) + 1;
    });

    // Date range
    const dates = transactions2025.map(t => t.transactionDate).sort();
    const earliestDate = dates[0];
    const latestDate = dates[dates.length - 1];

    console.log('📋 BEFORE DELETION - Statistics:');
    console.log('-'.repeat(80));
    console.log(`Total transactions:     ${count.toLocaleString()}`);
    console.log(`Deposits:               ${depositCount.toLocaleString()}`);
    console.log(`Withdrawals:            ${withdrawalCount.toLocaleString()}`);
    console.log(`Total amount:           UGX ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Date range:             ${earliestDate.toISOString().split('T')[0]} to ${latestDate.toISOString().split('T')[0]}`);
    console.log();
    console.log('Fund breakdown:');
    Object.entries(fundBreakdown).forEach(([fund, count]) => {
      console.log(`  ${fund.padEnd(10)} ${count.toLocaleString()} transactions`);
    });
    console.log();

    // Step 2: Confirm deletion
    console.log('⚠️  WARNING: This will DELETE all transactions shown above!');
    console.log('⚠️  This action CANNOT be undone!');
    console.log();
    console.log('Proceeding with deletion in 3 seconds...');
    console.log('Press Ctrl+C to cancel');
    console.log();

    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 3: Delete transactions
    console.log('🗑️  Deleting 2025 transactions...\n');

    const deleteResult = await prisma.fundTransaction.deleteMany({
      where: {
        transactionDate: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
    });

    console.log('✅ DELETION COMPLETE!');
    console.log('-'.repeat(80));
    console.log(`Deleted ${deleteResult.count.toLocaleString()} transactions`);
    console.log();

    // Step 4: Verify deletion
    console.log('🔍 Verifying deletion...\n');

    const remainingCount = await prisma.fundTransaction.count({
      where: {
        transactionDate: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
    });

    if (remainingCount === 0) {
      console.log('✅ Verification passed: No 2025 transactions remain');
    } else {
      console.log(`⚠️  Warning: ${remainingCount} transactions still found`);
    }

    // Step 5: Show remaining transactions by year
    console.log();
    console.log('📊 Remaining transactions by year:');
    console.log('-'.repeat(80));

    const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
    for (const year of years) {
      const yearCount = await prisma.fundTransaction.count({
        where: {
          transactionDate: {
            gte: new Date(`${year}-01-01`),
            lt: new Date(`${year + 1}-01-01`),
          },
        },
      });

      if (yearCount > 0) {
        console.log(`${year}:  ${yearCount.toLocaleString()} transactions`);
      }
    }

    console.log();
    console.log('='.repeat(80));
    console.log('✅ DELETION COMPLETE - You can now re-upload 2025 transactions with the new columns');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error during deletion:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
delete2025Transactions()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
