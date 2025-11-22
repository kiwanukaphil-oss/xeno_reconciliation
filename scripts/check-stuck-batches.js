const { PrismaClient } = require('@prisma/client');

async function checkStuckBatches() {
  const prisma = new PrismaClient();

  try {
    // Find batches that are stuck in PROCESSING or VALIDATING for more than 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const stuckBatches = await prisma.uploadBatch.findMany({
      where: {
        processingStatus: {
          in: ['PROCESSING', 'VALIDATING', 'PARSING']
        },
        processingStartedAt: {
          lt: tenMinutesAgo
        }
      },
      select: {
        id: true,
        batchNumber: true,
        fileName: true,
        processingStatus: true,
        validationStatus: true,
        processingStartedAt: true,
        totalRecords: true,
        processedRecords: true,
        failedRecords: true,
      },
      orderBy: {
        processingStartedAt: 'desc'
      }
    });

    console.log(`\n=== STUCK BATCHES (in processing for >10 minutes) ===\n`);

    if (stuckBatches.length === 0) {
      console.log('No stuck batches found.');
    } else {
      stuckBatches.forEach(batch => {
        const duration = Math.floor((Date.now() - new Date(batch.processingStartedAt).getTime()) / 60000);
        console.log(`Batch ID: ${batch.id}`);
        console.log(`Batch Number: ${batch.batchNumber}`);
        console.log(`File: ${batch.fileName}`);
        console.log(`Status: ${batch.processingStatus}`);
        console.log(`Started: ${batch.processingStartedAt}`);
        console.log(`Duration: ${duration} minutes`);
        console.log(`Records: ${batch.processedRecords}/${batch.totalRecords}`);
        console.log('---\n');
      });
    }

    // Also check for batches waiting for approval
    const waitingBatches = await prisma.uploadBatch.findMany({
      where: {
        processingStatus: 'WAITING_FOR_APPROVAL'
      },
      select: {
        id: true,
        batchNumber: true,
        fileName: true,
        newClientsDetected: true,
        newAccountsDetected: true,
        newGoalsDetected: true,
        newEntitiesStatus: true,
      }
    });

    console.log(`\n=== BATCHES WAITING FOR APPROVAL ===\n`);

    if (waitingBatches.length === 0) {
      console.log('No batches waiting for approval.');
    } else {
      waitingBatches.forEach(batch => {
        console.log(`Batch ID: ${batch.id}`);
        console.log(`Batch Number: ${batch.batchNumber}`);
        console.log(`File: ${batch.fileName}`);
        console.log(`New Entities: ${batch.newClientsDetected} clients, ${batch.newAccountsDetected} accounts, ${batch.newGoalsDetected} goals`);
        console.log(`Approval Status: ${batch.newEntitiesStatus}`);
        console.log('---\n');
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkStuckBatches();
