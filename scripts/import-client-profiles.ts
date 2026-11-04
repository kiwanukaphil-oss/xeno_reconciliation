import fs from 'fs';
import path from 'path';
import { prisma } from '../src/config/database';
import { ClientProfileImporter } from '../src/services/client-profile/ClientProfileImporter';
import { MaterializedViewService } from '../src/services/unit-registry/MaterializedViewService';
import { InsightSnapshotService } from '../src/services/client-insights/InsightSnapshotService';

/**
 * Imports account profiles, goal enrichment and Ultima goal snapshots (targets, values)
 * from Ultima "Client Data" and "Goal Stats" exports.
 * Only accounts/goals already in the system are touched; everything else is ignored.
 *
 * Run with (each export file is loaded whole, ~1.2 GB peak for a 22 MB file, hence the larger heap):
 *   $env:NODE_OPTIONS="--max-old-space-size=4096"; npx ts-node scripts/import-client-profiles.ts "Client data" --dry-run
 *   $env:NODE_OPTIONS="--max-old-space-size=4096"; npx ts-node scripts/import-client-profiles.ts "Client data"
 *
 * The folder is searched recursively for .xlsx files. A JSON report is written to logs/.
 */
async function runClientProfileImport() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const folder = args.find((a) => !a.startsWith('--'));
  const asOfArg = args.find((a) => a.startsWith('--as-of='))?.split('=')[1];
  const asOfDate = asOfArg ? new Date(`${asOfArg}T00:00:00.000Z`) : undefined;
  if (!folder || !fs.existsSync(folder) || (asOfDate && isNaN(asOfDate.getTime()))) {
    console.error('Usage: npx ts-node scripts/import-client-profiles.ts <export-folder> [--dry-run] [--as-of=YYYY-MM-DD]');
    process.exit(1);
  }

  const files = findExcelFiles(folder);
  console.log(`${dryRun ? 'DRY RUN - ' : ''}Importing client profiles from ${files.length} files...\n`);
  const startedAt = Date.now();

  try {
    const report = await ClientProfileImporter.importFromFiles(files, { dryRun, asOfDate });
    if (!dryRun) {
      // The name-based gender estimator no longer reruns here: Client Insights reports declared gender only
      // (see GenderEstimator.ts, flagged for removal). It can still be run by hand: scripts/estimate-genders.ts
      console.log('Refreshing account_profile_aum and goal_holdings views...');
      await MaterializedViewService.refreshClientInsightViews();
      // Profiles and goal targets feed every as-at snapshot; they rebuild on the next upload or when opened
      await InsightSnapshotService.markStaleFrom(null, 'client profile import', { scheduleRebuild: false });
    }
    const reportPath = path.join('logs', `client-profile-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync('logs', { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const { accounts, goals } = report;
    console.log('='.repeat(60));
    console.log(`Rows read:            ${JSON.stringify(report.rowsRead)}`);
    console.log(`Accounts in system:   ${accounts.inSystem}`);
    console.log(`  profiled:           ${accounts.profiled}`);
    console.log(`  without profile:    ${accounts.withoutProfile}`);
    console.log(`Export rows ignored:  ${accounts.exportRowsNotInSystem} not in system, ${accounts.duplicateExportRows} duplicates`);
    console.log(`Goals in system:      ${goals.inSystem}, enriched ${goals.enriched}, goalType filled ${goals.goalTypeFilledFromOther}`);
    console.log(`Sign-up counts:       ${report.signups.accountsCounted} accounts, months written: ${report.signups.monthsWritten.length ? `${report.signups.monthsWritten[0]} to ${report.signups.monthsWritten[report.signups.monthsWritten.length - 1]}` : '-'}`);
    console.log(`Ultima goal snapshots: ${goals.ultimaSnapshots} (as of ${goals.snapshotAsOfDates.join(', ') || '-'}), targets ${goals.targetsFromUltima}`);
    for (const [name, counts] of Object.entries(report.distributions)) {
      console.log(`${name}: ${JSON.stringify(counts)}`);
    }
    console.log(`Top unmatched districts: ${report.unmatchedDistrictValues.slice(0, 25).map((d) => `${d.value}(${d.accounts})`).join(', ')}`);
    console.log('='.repeat(60));
    console.log(`${dryRun ? 'Dry run complete - nothing written' : 'Import complete'} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

function findExcelFiles(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) return findExcelFiles(fullPath);
    return entry.name.toLowerCase().endsWith('.xlsx') && !entry.name.startsWith('~$') ? [fullPath] : [];
  });
}

// Explicit exit: importing MaterializedViewService opens the queue's Redis connection, which would keep the process alive
runClientProfileImport()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Client profile import failed:', error);
    process.exit(1);
  });
