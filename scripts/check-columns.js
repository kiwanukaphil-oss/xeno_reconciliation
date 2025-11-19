const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkColumns() {
  try {
    console.log('Checking fund_transactions table columns...\n');

    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fund_transactions'
      ORDER BY ordinal_position;
    `;

    console.log('Columns in fund_transactions table:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type})`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkColumns();
