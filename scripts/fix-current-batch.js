const { PrismaClient } = require('@prisma/client');

async function fixBatch() {
  const prisma = new PrismaClient();

  try {
    const batchId = '481035eb-4500-456a-9e69-02e9d830890c';

    await prisma.uploadBatch.update({
      where: { id: batchId },
      data: {
        processingStatus: 'FAILED',
        validationStatus: 'FAILED',
        processingCompletedAt: new Date(),
      }
    });

    console.log('✅ Batch marked as FAILED');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

fixBatch();
