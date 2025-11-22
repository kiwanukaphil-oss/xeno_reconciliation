const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkValidationErrors() {
  try {
    const batchId = process.argv[2];

    if (!batchId) {
      console.error('Usage: node check-validation-errors.js <batchId>');
      process.exit(1);
    }

    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
      select: {
        batchNumber: true,
        fileName: true,
        processingStatus: true,
        validationStatus: true,
        validationErrors: true,
        validationWarnings: true,
      },
    });

    if (!batch) {
      console.log('Batch not found');
      process.exit(1);
    }

    console.log(`Batch: ${batch.batchNumber}`);
    console.log(`File: ${batch.fileName}`);
    console.log(`Processing Status: ${batch.processingStatus}`);
    console.log(`Validation Status: ${batch.validationStatus}`);
    console.log('\n=== VALIDATION ERRORS ===');
    console.log(JSON.stringify(batch.validationErrors, null, 2));
    console.log('\n=== VALIDATION WARNINGS ===');
    console.log(JSON.stringify(batch.validationWarnings, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkValidationErrors();
