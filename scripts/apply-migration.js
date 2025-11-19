const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  try {
    console.log('Connected to database');

    // Read the migration SQL file
    const migrationPath = path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20251119120000_add_goal_transactions_view',
      'migration.sql'
    );

    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log('Running migration SQL...');
    console.log(`SQL file size: ${sql.length} characters`);

    // Split SQL into individual statements and execute them
    // First, remove comment lines from the SQL
    const sqlWithoutComments = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = sqlWithoutComments
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`Found ${statements.length} statements to execute`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n--- Statement ${i + 1}/${statements.length} ---`);
      console.log(statement.substring(0, 100) + '...');
      try {
        await prisma.$executeRawUnsafe(statement);
        console.log('✓ Success');
      } catch (error) {
        console.log('✗ Error:', error.message);
        // Ignore COMMENT statements errors
        if (!statement.toUpperCase().includes('COMMENT ON')) {
          throw error;
        }
      }
    }

    console.log('✓ Materialized view created successfully!');

    // Update the _prisma_migrations table to mark this migration as applied
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid(), '', NOW(), '20251119120000_add_goal_transactions_view', NULL, NULL, NOW(), 1)
       ON CONFLICT DO NOTHING`
    );

    console.log('✓ Migration marked as applied');
  } catch (error) {
    console.error('Error applying migration:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('Disconnected from database');
  }
}

applyMigration();
