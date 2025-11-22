const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addPooledAccountType() {
  try {
    console.log('Adding POOLED and LINKED to AccountType enum...');

    await prisma.$executeRawUnsafe(`
      ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'POOLED';
    `);
    console.log('✅ POOLED account type added');

    await prisma.$executeRawUnsafe(`
      ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'LINKED';
    `);
    console.log('✅ LINKED account type added');

    console.log('\n✅ All account types added successfully');
  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Value already exists in AccountType enum');
    }
  } finally {
    await prisma.$disconnect();
  }
}

addPooledAccountType();
