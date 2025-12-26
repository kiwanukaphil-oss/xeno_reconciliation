// Script to add REVERSAL_NETTED to VarianceReviewTag enum
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    // Add the new enum value to PostgreSQL
    await prisma.$executeRawUnsafe(`
      ALTER TYPE "VarianceReviewTag" ADD VALUE IF NOT EXISTS 'REVERSAL_NETTED';
    `);
    console.log('Successfully added REVERSAL_NETTED to VarianceReviewTag enum');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('REVERSAL_NETTED already exists in VarianceReviewTag enum');
    } else {
      console.error('Error adding enum value:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
