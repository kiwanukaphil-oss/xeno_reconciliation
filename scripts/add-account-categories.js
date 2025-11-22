const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addAccountCategories() {
  try {
    console.log('Adding INVESTMENT_CLUBS and RETIREMENTS_BENEFIT_SCHEME to AccountCategory enum...');

    await prisma.$executeRawUnsafe(`
      ALTER TYPE "AccountCategory" ADD VALUE IF NOT EXISTS 'INVESTMENT_CLUBS';
    `);
    console.log('✅ INVESTMENT_CLUBS account category added');

    await prisma.$executeRawUnsafe(`
      ALTER TYPE "AccountCategory" ADD VALUE IF NOT EXISTS 'RETIREMENTS_BENEFIT_SCHEME';
    `);
    console.log('✅ RETIREMENTS_BENEFIT_SCHEME account category added');

    console.log('\n✅ All account categories added successfully');
  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Value already exists in AccountCategory enum');
    }
  } finally {
    await prisma.$disconnect();
  }
}

addAccountCategories();
