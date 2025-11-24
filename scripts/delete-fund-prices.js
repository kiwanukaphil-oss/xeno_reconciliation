const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting all fund prices from the database...');

  const result = await prisma.fundPrice.deleteMany({});

  console.log(`✓ Deleted ${result.count} fund price records`);
  console.log('All fake prices have been removed. Fund prices must now be uploaded manually.');
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
