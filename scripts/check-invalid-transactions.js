const { PrismaClient } = require('@prisma/client');

async function checkInvalidTransactions() {
  const prisma = new PrismaClient();

  try {
    const batchId = process.argv[2];

    if (!batchId) {
      console.error('Usage: node check-invalid-transactions.js <batchId>');
      process.exit(1);
    }

    const invalidTransactions = await prisma.invalidFundTransaction.findMany({
      where: { uploadBatchId: batchId },
      orderBy: { rowNumber: 'asc' },
      take: 10, // Show first 10
    });

    console.log(`Found ${invalidTransactions.length} invalid transactions\n`);

    invalidTransactions.forEach((invalid, index) => {
      console.log(`\n=== Invalid Transaction ${index + 1} ===`);
      console.log(`Row Number: ${invalid.rowNumber}`);
      console.log(`Raw Data:`, JSON.stringify(invalid.rawData, null, 2));
      console.log(`Validation Errors:`, JSON.stringify(invalid.validationErrors, null, 2));
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkInvalidTransactions();
