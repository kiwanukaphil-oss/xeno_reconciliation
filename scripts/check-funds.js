const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkFunds() {
  try {
    console.log('Checking funds in database...\n');

    const funds = await prisma.fund.findMany({
      select: {
        id: true,
        fundCode: true,
        fundName: true,
        status: true,
      },
      orderBy: {
        fundCode: 'asc',
      },
    });

    console.log('Funds in database:');
    funds.forEach(fund => {
      console.log(`  - Code: "${fund.fundCode}" | Name: ${fund.fundName} | Status: ${fund.status}`);
    });

    console.log(`\nTotal funds: ${funds.length}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkFunds();
