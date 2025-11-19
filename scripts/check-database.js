const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    console.log('Checking database tables and views...\n');

    // Check tables
    const tables = await prisma.$queryRaw`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `;

    console.log('Tables in database:');
    console.log(tables);

    // Check materialized views
    const views = await prisma.$queryRaw`
      SELECT matviewname
      FROM pg_catalog.pg_matviews
      WHERE schemaname = 'public';
    `;

    console.log('\nMaterialized views in database:');
    console.log(views);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
