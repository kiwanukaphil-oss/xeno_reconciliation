const { PrismaClient } = require('@prisma/client');

async function checkAccountCategories() {
  const prisma = new PrismaClient();

  try {
    const results = await prisma.$queryRaw`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AccountCategory')
      ORDER BY enumsortorder
    `;

    console.log('AccountCategory enum values in database:');
    results.forEach(r => console.log('  -', r.enumlabel));

    // Also check if we can use them in Prisma
    const { AccountCategory } = require('@prisma/client');
    console.log('\nAccountCategory values in Prisma Client:');
    Object.keys(AccountCategory).forEach(key => console.log('  -', key));

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAccountCategories();
