const { PrismaClient } = require('@prisma/client');

async function fixStuckBatch() {
  const prisma = new PrismaClient();

  try {
    const batchId = '065c278c-6d2e-46fd-8bc6-1deb1cf09d86';

    console.log(`Fixing stuck batch: ${batchId}\n`);

    // Get current batch info
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
      select: {
        batchNumber: true,
        fileName: true,
        processingStatus: true,
        validationErrors: true,
      }
    });

    if (!batch) {
      console.log('Batch not found!');
      return;
    }

    console.log('Current status:', batch.processingStatus);
    console.log('File:', batch.fileName);
    console.log('Batch Number:', batch.batchNumber);

    // Update to FAILED status
    const updated = await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        processingStatus: 'FAILED',
        validationStatus: 'FAILED',
        processingCompletedAt: new Date(),
      }
    });

    console.log('\n✅ Batch status updated to FAILED');
    console.log('Processing completed at:', updated.processingCompletedAt);

    // Check validation errors
    if (batch.validationErrors) {
      console.log('\nValidation errors present:');
      if (batch.validationErrors.summary) {
        console.log('Summary:', batch.validationErrors.summary);
      }
      if (batch.validationErrors.errors && Array.isArray(batch.validationErrors.errors)) {
        console.log(`Number of errors: ${batch.validationErrors.errors.length}`);
        console.log('\nFirst error:');
        console.log(JSON.stringify(batch.validationErrors.errors[0], null, 2));
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixStuckBatch();
