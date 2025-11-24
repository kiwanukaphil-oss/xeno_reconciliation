const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Checking database state...\n');

  // Check fund price count
  const priceCount = await prisma.fundPrice.count();
  console.log(`Current fund prices in database: ${priceCount}`);

  // Check if there are any audit logs or related tables
  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name LIKE '%fund%' OR table_name LIKE '%price%' OR table_name LIKE '%audit%'
  `;

  console.log('\nRelevant tables:', tables);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
