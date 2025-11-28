import { prisma } from '../src/config/database';

/**
 * Refreshes all materialized views
 * Run with: npx ts-node scripts/refresh-all-materialized-views.ts
 */

async function refreshAllMaterializedViews() {
  console.log('🔄 Refreshing all materialized views...\n');

  try {
    // List all materialized views
    const matViews = await prisma.$queryRaw<Array<{
      schemaname: string;
      matviewname: string;
    }>>`
      SELECT schemaname, matviewname
      FROM pg_matviews
      WHERE schemaname = 'public'
    `;

    console.log(`Found ${matViews.length} materialized views to refresh:\n`);

    for (const view of matViews) {
      console.log(`Refreshing: ${view.matviewname}...`);

      try {
        // Try concurrent refresh first (faster, but requires unique index)
        await prisma.$executeRawUnsafe(
          `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view.matviewname}`
        );
        console.log(`✅ ${view.matviewname} refreshed (concurrent)`);
      } catch (error: any) {
        // If concurrent fails, try regular refresh
        if (error.message?.includes('unique index')) {
          console.log(`  No unique index, using regular refresh...`);
          await prisma.$executeRawUnsafe(
            `REFRESH MATERIALIZED VIEW ${view.matviewname}`
          );
          console.log(`✅ ${view.matviewname} refreshed (regular)`);
        } else {
          throw error;
        }
      }

      console.log();
    }

    console.log('='.repeat(60));
    console.log('✅ All materialized views refreshed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error refreshing materialized views:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
refreshAllMaterializedViews()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
