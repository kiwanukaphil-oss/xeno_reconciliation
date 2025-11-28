import { prisma } from '../src/config/database';

/**
 * Investigates a specific goal transaction to check transaction IDs
 * Run with: npx ts-node scripts/investigate-transaction-id.ts
 */

async function investigateTransactionId() {
  console.log('🔍 INVESTIGATING GOAL TRANSACTION\n');
  console.log('='.repeat(80));

  const goalTransactionCode = '2025-01-28-751-255234483-751-2552344839a';

  try {
    // Find all fund transactions for this goal transaction
    const fundTransactions = await prisma.fundTransaction.findMany({
      where: {
        goalTransactionCode: goalTransactionCode,
      },
      select: {
        id: true,
        goalTransactionCode: true,
        transactionId: true,
        source: true,
        amount: true,
        transactionDate: true,
        fund: {
          select: {
            fundCode: true,
          },
        },
        uploadBatch: {
          select: {
            batchNumber: true,
            fileName: true,
          },
        },
      },
      orderBy: {
        fund: {
          fundCode: 'asc',
        },
      },
    });

    console.log(`\nGoal Transaction Code: ${goalTransactionCode}`);
    console.log(`Found ${fundTransactions.length} fund transactions\n`);

    if (fundTransactions.length === 0) {
      console.log('❌ No transactions found for this goal transaction code.');
      console.log('This might be from a failed upload or the code was entered incorrectly.\n');
      return;
    }

    // Group by transactionId to see the issue
    const byTransactionId = new Map<string, typeof fundTransactions>();
    fundTransactions.forEach((txn) => {
      const id = txn.transactionId || 'NULL';
      if (!byTransactionId.has(id)) {
        byTransactionId.set(id, []);
      }
      byTransactionId.get(id)!.push(txn);
    });

    console.log('📊 TRANSACTION ID ANALYSIS:\n');
    console.log(`Unique Transaction IDs found: ${byTransactionId.size}\n`);

    // Show each unique transaction ID
    let index = 1;
    for (const [transactionId, txns] of byTransactionId.entries()) {
      console.log(`Transaction ID ${index}: "${transactionId}"`);
      console.log(`  Length: ${transactionId.length} characters`);
      console.log(`  Hex: ${Buffer.from(transactionId).toString('hex')}`);
      console.log(`  Fund transactions with this ID: ${txns.length}`);
      console.log(`  Funds: ${txns.map(t => t.fund.fundCode).join(', ')}`);
      console.log(`  Sources: ${[...new Set(txns.map(t => t.source))].join(', ')}`);
      console.log();
      index++;
    }

    // Show detailed breakdown
    console.log('\n📋 DETAILED TRANSACTION BREAKDOWN:\n');
    console.table(
      fundTransactions.map((txn) => ({
        fundCode: txn.fund.fundCode,
        transactionId: txn.transactionId,
        transactionIdLength: txn.transactionId?.length || 0,
        source: txn.source,
        amount: txn.amount.toString(),
        date: txn.transactionDate.toISOString().split('T')[0],
        batchFile: txn.uploadBatch.fileName,
      }))
    );

    // Check if the issue is real or a bug
    console.log('\n🔬 VALIDATION:\n');
    const uniqueIds = new Set(fundTransactions.map((t) => t.transactionId));
    if (uniqueIds.size > 1) {
      console.log('❌ VALIDATION FAILED: Multiple transaction IDs detected');
      console.log('   This goal transaction has inconsistent transaction IDs.');
      console.log('   All fund transactions in a goal transaction MUST have the same transaction ID.\n');
      console.log('   Unique IDs:');
      Array.from(uniqueIds).forEach((id, idx) => {
        console.log(`   ${idx + 1}. "${id}" (${id?.length || 0} chars)`);
      });
    } else {
      console.log('✅ VALIDATION PASSED: All transactions have the same transaction ID');
      console.log(`   Transaction ID: "${fundTransactions[0].transactionId}"`);
    }

    // Check sources too
    const uniqueSources = new Set(fundTransactions.map((t) => t.source));
    if (uniqueSources.size > 1) {
      console.log('\n❌ VALIDATION FAILED: Multiple sources detected');
      console.log('   Unique Sources:', Array.from(uniqueSources).join(', '));
    } else {
      console.log(`\n✅ Source is consistent: ${fundTransactions[0].source}`);
    }

    console.log('\n' + '='.repeat(80));
  } catch (error) {
    console.error('❌ Error during investigation:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
investigateTransactionId().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
