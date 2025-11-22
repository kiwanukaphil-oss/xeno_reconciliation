const { PrismaClient } = require('@prisma/client');

async function checkAccountTypes() {
  const prisma = new PrismaClient();

  try {
    const results = await prisma.$queryRaw`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AccountType')
      ORDER BY enumsortorder
    `;

    console.log('AccountType enum values in database:');
    results.forEach(r => console.log('  -', r.enumlabel));

    // Also check if we can use LINKED in Prisma
    const { AccountType } = require('@prisma/client');
    console.log('\nAccountType values in Prisma Client:');
    Object.keys(AccountType).forEach(key => console.log('  -', key));

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAccountTypes();
