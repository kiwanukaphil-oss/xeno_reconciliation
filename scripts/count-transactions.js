const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const fundTxCount = await prisma.fundTransaction.count();
  const accountCount = await prisma.account.count();
  const clientCount = await prisma.client.count();

  console.log('Database counts:');
  console.log('  Clients:', clientCount);
  console.log('  Accounts:', accountCount);
  console.log('  Fund Transactions:', fundTxCount);

  await prisma.$disconnect();
}

main().catch(console.error);
