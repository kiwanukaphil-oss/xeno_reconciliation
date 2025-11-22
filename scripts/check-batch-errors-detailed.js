const { PrismaClient } = require('@prisma/client');

async function checkBatchErrors() {
  const prisma = new PrismaClient();

  try {
    // Get the most recent batch
    const batch = await prisma.uploadBatch.findFirst({
      orderBy: { uploadedAt: 'desc' },
      select: {
        id: true,
        batchNumber: true,
        fileName: true,
        processingStatus: true,
        validationStatus: true,
        validationErrors: true,
        totalRecords: true,
        uploadedAt: true,
      }
    });

    if (!batch) {
      console.log('Batch not found!');
      return;
    }

    console.log('=== LATEST BATCH ===');
    console.log('ID:', batch.id);
    console.log('Batch:', batch.batchNumber);
    console.log('File:', batch.fileName);
    console.log('Status:', batch.processingStatus);
    console.log('Validation Status:', batch.validationStatus);
    console.log('Total Records:', batch.totalRecords);
    console.log('Uploaded At:', batch.uploadedAt);
    console.log('\n=== FULL VALIDATION ERRORS OBJECT ===');
    console.log(JSON.stringify(batch.validationErrors, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkBatchErrors();
