import { prisma } from '../src/config/database';
import { GENDER_CONFIDENCE_THRESHOLD, GenderEstimator } from '../src/services/client-profile/GenderEstimator';
import { MaterializedViewService } from '../src/services/unit-registry/MaterializedViewService';

/**
 * CANDIDATE FOR REMOVAL: Client Insights no longer uses name-based gender estimates; gender
 * figures come from declared gender only, with the unidentified allocated in the known ratio
 * (src/services/client-insights/GenderAllocation.ts).
 *
 * Retrains the name-based gender estimator and rescores personal accounts with no
 * declared gender. (No longer run automatically by import-client-profiles.ts.)
 *
 *   npx ts-node scripts/estimate-genders.ts --dry-run   (validation only, nothing written)
 *   npx ts-node scripts/estimate-genders.ts
 */
async function runGenderEstimation() {
  const dryRun = process.argv.includes('--dry-run');
  try {
    const report = await GenderEstimator.run({ dryRun });
    if (!dryRun) {
      console.log('Refreshing account_profile_aum and goal_holdings views...');
      await MaterializedViewService.refreshClientInsightViews();
    }
    const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
    const { holdout } = report;
    console.log('='.repeat(60));
    console.log(`Model ${report.modelVersion}, trained on ${report.labelledAccounts} declared personal accounts`);
    console.log(`Hold-out (${holdout.accounts} accounts) at ${GENDER_CONFIDENCE_THRESHOLD} confidence: accuracy ${pct(holdout.accuracy)}, coverage ${pct(holdout.coverage)}`);
    console.log(`  MTN sign-ups only (${holdout.mtnAccounts}): accuracy ${pct(holdout.mtnAccuracy)}`);
    console.log(`  Weighted female share: predicted ${pct(holdout.predictedFemaleShare)} vs declared ${pct(holdout.actualFemaleShare)}`);
    console.table(holdout.byThreshold.map((t) => ({ threshold: t.threshold, coverage: pct(t.coverage), accuracy: pct(t.accuracy) })));
    console.log(`Accounts without declared gender: ${report.accountsToEstimate}`);
    console.log(`  scored ${report.scoredAccounts}, labelled ${report.labelledEstimates}, unscorable ${report.unscorableAccounts}`);
    console.log(`  estimated female share of scored: ${pct(report.estimatedFemaleShareOfScored)}`);
    console.log('='.repeat(60));
    console.log(dryRun ? 'Dry run complete - nothing written' : 'Estimates written');
  } finally {
    await prisma.$disconnect();
  }
}

// Explicit exit: importing MaterializedViewService opens the queue's Redis connection
runGenderEstimation()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Gender estimation failed:', error);
    process.exit(1);
  });
