const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkBatchStatus() {
  try {
    console.log('Checking recent upload batches...\n');

    const batches = await prisma.uploadBatch.findMany({
      orderBy: {
        uploadedAt: 'desc',
      },
      take: 5,
      select: {
        id: true,
        batchNumber: true,
        fileName: true,
        processingStatus: true,
        validationStatus: true,
        totalRecords: true,
        processedRecords: true,
        failedRecords: true,
        newEntitiesStatus: true,
        uploadedAt: true,
        processingCompletedAt: true,
      },
    });

    console.log('Recent batches:');
    batches.forEach(batch => {
      console.log(`\n  Batch: ${batch.batchNumber}`);
      console.log(`  ID: ${batch.id}`);
      console.log(`  File: ${batch.fileName}`);
      console.log(`  Processing Status: ${batch.processingStatus}`);
      console.log(`  Validation Status: ${batch.validationStatus}`);
      console.log(`  New Entities Status: ${batch.newEntitiesStatus || 'N/A'}`);
      console.log(`  Total Records: ${batch.totalRecords}`);
      console.log(`  Processed: ${batch.processedRecords}`);
      console.log(`  Failed: ${batch.failedRecords}`);
      console.log(`  Uploaded: ${batch.uploadedAt}`);
      console.log(`  Completed: ${batch.processingCompletedAt || 'Not completed'}`);
    });

    // Check fund transactions count
    console.log('\n\nChecking fund transactions...');
    const fundTransactionCount = await prisma.fundTransaction.count();
    console.log(`Total fund transactions in database: ${fundTransactionCount}`);

    // Check goal transactions from materialized view
    console.log('\nChecking materialized view...');
    const goalTransactions = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM goal_transactions_view
    `;
    console.log(`Goal transactions in materialized view: ${goalTransactions[0].count}`);

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkBatchStatus();
