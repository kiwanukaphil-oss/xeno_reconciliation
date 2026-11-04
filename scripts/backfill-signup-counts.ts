import fs from 'fs';
import path from 'path';
import { prisma } from '../src/config/database';
import { SignupCountCollector } from '../src/services/client-profile/SignupCountCollector';
import { readUltimaExportRows } from '../src/services/client-profile/UltimaExportReader';

/**
 * Counts Ultima sign-ups per month and channel from Client Data / Client Extra Data exports, without
 * re-importing profiles (the regular profile import does the same counting as part of its run).
 * Only file names containing "Client Data" or "Client Extra Data" are read. Every month seen is
 * replaced, so give all parts of a multi-part export in one run.
 *
 *   $env:NODE_OPTIONS="--max-old-space-size=8192"; npx ts-node scripts/backfill-signup-counts.ts "Client data" [--dry-run]
 */
async function runSignupBackfill() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const folder = args.find((a) => !a.startsWith('--'));
  if (!folder || !fs.existsSync(folder)) {
    console.error('Usage: npx ts-node scripts/backfill-signup-counts.ts <export-folder> [--dry-run]');
    process.exit(1);
  }

  const files = findClientExportFiles(folder).sort();
  const collector = new SignupCountCollector();
  for (const file of files) {
    console.log(`Reading ${file}`);
    for await (const { sheet, row } of readUltimaExportRows(file)) {
      if (sheet === 'CLIENT_ACCOUNTS') collector.add(row);
    }
  }

  const counts = collector.counts();
  const byMonth = new Map<string, { accounts: number; users: number }>();
  for (const c of counts) {
    const m = byMonth.get(c.month) ?? { accounts: 0, users: 0 };
    m.accounts += c.newAccounts;
    m.users += c.newUsers;
    byMonth.set(c.month, m);
  }
  let registered = 0;
  console.log('\nmonth     new accounts  new users  registered (running)');
  for (const [month, m] of byMonth) {
    registered += m.users;
    console.log(`${month}  ${String(m.accounts).padStart(12)}  ${String(m.users).padStart(9)}  ${String(registered).padStart(10)}`);
  }

  if (dryRun) {
    console.log(`\nDry run: ${collector.accountsCounted} accounts counted, nothing written`);
  } else {
    const months = await collector.write();
    console.log(`\nWrote ${counts.length} rows for ${months.length} months (${months[0]} to ${months[months.length - 1]})`);
  }
  await prisma.$disconnect();
}

function findClientExportFiles(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) return findClientExportFiles(fullPath);
    const isClientExport = /client (extra )?data/i.test(entry.name) && entry.name.toLowerCase().endsWith('.xlsx');
    return isClientExport && !entry.name.startsWith('~$') ? [fullPath] : [];
  });
}

runSignupBackfill().catch((error) => {
  console.error('Sign-up backfill failed:', error);
  process.exit(1);
});
