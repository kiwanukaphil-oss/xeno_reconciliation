import { prisma } from '../src/config/database';

async function checkViewStructure() {
  try {
    console.log('Checking goal_transactions_view structure:\n');

    const cols = await prisma.$queryRaw<Array<{
      column_name: string;
      data_type: string;
    }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'goal_transactions_view'
      ORDER BY ordinal_position
    `;

    console.table(cols);

    // Try to get a sample row
    console.log('\nSample data from goal_transactions_view:');
    const sample = await prisma.$queryRaw`SELECT * FROM goal_transactions_view LIMIT 1`;
    console.log(sample);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkViewStructure();
