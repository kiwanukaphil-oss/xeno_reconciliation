import { prisma } from '../src/config/database';

/**
 * Cleans up orphaned upload batches (batches with no transactions)
 * Specifically targets 2025 batches that had transactions deleted
 * Run with: npx ts-node scripts/cleanup-orphaned-batches.ts
 */

async function cleanupOrphanedBatches() {
  console.log('🧹 CLEANUP ORPHANED UPLOAD BATCHES\n');
  console.log('='.repeat(80));

  try {
    // Step 1: Find all batches from 2025 that have no transactions
    console.log('\n1️⃣  Finding orphaned 2025 upload batches...\n');

    const batches2025 = await prisma.uploadBatch.findMany({
      where: {
        uploadedAt: {
          gte: new Date('2025-01-01'),
          lt: new Date('2026-01-01'),
        },
      },
      select: {
        id: true,
        batchNumber: true,
        fileName: true,
        uploadedAt: true,
        totalRecords: true,
        processingStatus: true,
        _count: {
          select: {
            fundTransactions: true,
          },
        },
      },
    });

    console.log(`Found ${batches2025.length} upload batches from 2025`);

    // Filter orphaned batches (0 transactions)
    const orphanedBatches = batches2025.filter((b) => b._count.fundTransactions === 0);

    if (orphanedBatches.length === 0) {
      console.log('✅ No orphaned batches found. Nothing to clean up.');
      return;
    }

    console.log(`\n📋 Found ${orphanedBatches.length} orphaned batches (with 0 transactions):\n`);
    console.table(
      orphanedBatches.map((b) => ({
        batchNumber: b.batchNumber,
        fileName: b.fileName,
        uploadedAt: b.uploadedAt.toISOString().split('T')[0],
        totalRecords: b.totalRecords,
        status: b.processingStatus,
        transactions: b._count.fundTransactions,
      }))
    );

    // Step 2: Confirm deletion
    console.log('\n⚠️  WARNING: These batches will be DELETED!');
    console.log('⚠️  This action CANNOT be undone!');
    console.log('\nProceeding with deletion in 3 seconds...');
    console.log('Press Ctrl+C to cancel\n');

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Step 3: Delete orphaned batches
    console.log('🗑️  Deleting orphaned batches...\n');

    let deletedCount = 0;

    for (const batch of orphanedBatches) {
      // Delete invalid transactions first (if any)
      await prisma.invalidFundTransaction.deleteMany({
        where: { uploadBatchId: batch.id },
      });

      // Delete the batch
      await prisma.uploadBatch.delete({
        where: { id: batch.id },
      });

      deletedCount++;
      console.log(`  ✅ Deleted: ${batch.batchNumber} (${batch.fileName})`);
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✅ CLEANUP COMPLETE`);
    console.log(`Deleted ${deletedCount} orphaned upload batches`);
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
cleanupOrphanedBatches()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
