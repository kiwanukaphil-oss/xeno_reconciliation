/*
 * CANDIDATE FOR REMOVAL: Client Insights no longer uses name-based gender estimates; gender
 * figures come from declared gender only, with the unidentified allocated in the known ratio
 * (src/services/client-insights/GenderAllocation.ts).
 * Kept, with its tables and columns, until removal is confirmed; nothing runs it automatically.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';

export const GENDER_MODEL_VERSION = 'name-nb-v1';
/** Minimum confidence (probability of the likelier gender) for an estimated gender label. */
export const GENDER_CONFIDENCE_THRESHOLD = 0.9;
const MIN_NAME_PART_OCCURRENCES = 3;
const HOLDOUT_SHARE = 0.2;
const HOLDOUT_SEED = 7;
const REPORTED_THRESHOLDS = [0.5, 0.8, 0.9, 0.95, 0.99];
const WRITE_BATCH_SIZE = 1000;

interface NamedAccount {
  profileId: string;
  name: string;
  gender: string;
  signupChannel: string | null;
}

interface ThresholdMetrics {
  threshold: number;
  coverage: number;
  accuracy: number;
}

export interface LatestGenderEstimateRun {
  modelVersion: string;
  runAt: Date;
  confidenceThreshold: number;
  labelledAccounts: number;
  scoredAccounts: number;
  labelledEstimates: number;
  holdoutAccuracy: number;
  holdoutCoverage: number;
  mtnHoldoutAccuracy: number | null;
  predictedFemaleShare: number;
  actualFemaleShare: number;
}

export interface GenderEstimateReport {
  modelVersion: string;
  dryRun: boolean;
  labelledAccounts: number;
  accountsToEstimate: number;
  scoredAccounts: number;
  labelledEstimates: number;
  unscorableAccounts: number;
  holdout: {
    accounts: number;
    accuracy: number;
    coverage: number;
    mtnAccuracy: number | null;
    mtnAccounts: number;
    predictedFemaleShare: number;
    actualFemaleShare: number;
    byThreshold: ThresholdMetrics[];
  };
  estimatedFemaleShareOfScored: number;
}

/** Upper-case name parts of two or more letters, e.g. "Nakato  Jane M." -> ["NAKATO", "JANE"]. */
export function splitNameIntoParts(name: string): string[] {
  const parts = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((p) => p.length >= 2);
  return [...new Set(parts)];
}

/**
 * Naive Bayes over name parts, learned from accounts with a declared gender.
 * Each part seen at least MIN_NAME_PART_OCCURRENCES times contributes the log-odds
 * of male vs female among holders with that part (with 0.5 smoothing); parts seen
 * less often are ignored. A name with no usable part cannot be scored.
 */
export class NameGenderModel {
  private constructor(
    private readonly partCounts: Map<string, { male: number; female: number }>,
    private readonly priorLogOdds: number
  ) {}

  static train(examples: Array<{ name: string; gender: string }>): NameGenderModel {
    const partCounts = new Map<string, { male: number; female: number }>();
    let males = 0;
    let females = 0;
    for (const example of examples) {
      const isMale = example.gender === 'MALE';
      isMale ? males++ : females++;
      for (const part of splitNameIntoParts(example.name)) {
        const counts = partCounts.get(part) ?? { male: 0, female: 0 };
        isMale ? counts.male++ : counts.female++;
        partCounts.set(part, counts);
      }
    }
    return new NameGenderModel(partCounts, Math.log((males || 1) / (females || 1)));
  }

  /** Probability the holder is female, or null when no name part is known well enough. */
  femaleProbability(name: string): number | null {
    let maleLogOdds = this.priorLogOdds;
    let partsUsed = 0;
    for (const part of splitNameIntoParts(name)) {
      const counts = this.partCounts.get(part);
      if (!counts || counts.male + counts.female < MIN_NAME_PART_OCCURRENCES) continue;
      maleLogOdds += Math.log((counts.male + 0.5) / (counts.female + 0.5)) - this.priorLogOdds;
      partsUsed++;
    }
    return partsUsed ? 1 - 1 / (1 + Math.exp(-maleLogOdds)) : null;
  }
}

/** Gender label for a probability, or null when below the confidence threshold. */
function confidentGender(femaleProbability: number, threshold = GENDER_CONFIDENCE_THRESHOLD): 'FEMALE' | 'MALE' | null {
  if (femaleProbability >= threshold) return 'FEMALE';
  if (1 - femaleProbability >= threshold) return 'MALE';
  return null;
}

/**
 * Estimates gender from client names for personal accounts with no declared gender.
 * Every run first measures accuracy on a fixed 20% hold-out of declared accounts,
 * then retrains on all of them and scores the rest. Declared gender is never changed;
 * "rather not say" accounts and joint/institutional accounts are never estimated.
 * Names are read from the system's own client records and never leave the database.
 */
export class GenderEstimator {
  static async run(options: { dryRun?: boolean } = {}): Promise<GenderEstimateReport> {
    const dryRun = options.dryRun ?? false;
    const accounts = await this.loadPersonalAccounts();
    const labelled = accounts.filter((a) => a.gender === 'MALE' || a.gender === 'FEMALE');
    const toEstimate = accounts.filter((a) => a.gender === 'UNKNOWN');

    const holdout = this.validateOnHoldout(labelled);
    const model = NameGenderModel.train(labelled);
    const estimates = toEstimate
      .map((a) => ({ profileId: a.profileId, femaleProbability: model.femaleProbability(a.name) }))
      .filter((e): e is { profileId: string; femaleProbability: number } => e.femaleProbability !== null);
    const labelledEstimates = estimates.filter((e) => confidentGender(e.femaleProbability) !== null).length;

    const report: GenderEstimateReport = {
      modelVersion: GENDER_MODEL_VERSION,
      dryRun,
      labelledAccounts: labelled.length,
      accountsToEstimate: toEstimate.length,
      scoredAccounts: estimates.length,
      labelledEstimates,
      unscorableAccounts: toEstimate.length - estimates.length,
      holdout,
      estimatedFemaleShareOfScored: estimates.length
        ? estimates.reduce((s, e) => s + e.femaleProbability, 0) / estimates.length
        : 0,
    };

    if (!dryRun) {
      await this.writeEstimates(estimates);
      const metrics = JSON.stringify({ byThreshold: holdout.byThreshold, holdoutAccounts: holdout.accounts, mtnHoldoutAccounts: holdout.mtnAccounts });
      await prisma.$executeRaw`
        INSERT INTO gender_estimate_runs (id, "modelVersion", "confidenceThreshold", "labelledAccounts", "scoredAccounts",
          "labelledEstimates", "unscorableAccounts", "holdoutAccuracy", "holdoutCoverage", "mtnHoldoutAccuracy",
          "predictedFemaleShare", "actualFemaleShare", metrics)
        VALUES (gen_random_uuid()::text, ${GENDER_MODEL_VERSION}, ${GENDER_CONFIDENCE_THRESHOLD}, ${report.labelledAccounts},
          ${report.scoredAccounts}, ${report.labelledEstimates}, ${report.unscorableAccounts}, ${holdout.accuracy},
          ${holdout.coverage}, ${holdout.mtnAccuracy}::float8, ${holdout.predictedFemaleShare}, ${holdout.actualFemaleShare},
          ${metrics}::jsonb)`;
    }
    logger.info(
      `Gender estimates (${dryRun ? 'dry run' : 'written'}): ${estimates.length} scored, ${labelledEstimates} labelled, ` +
        `hold-out accuracy ${(holdout.accuracy * 100).toFixed(1)}% at ${GENDER_CONFIDENCE_THRESHOLD}`
    );
    return report;
  }

  /** Latest run's validation figures, for disclosure alongside estimated figures. */
  static async getLatestRun(): Promise<LatestGenderEstimateRun | null> {
    const [run] = await prisma.$queryRaw<LatestGenderEstimateRun[]>`
      SELECT "modelVersion", "runAt", "confidenceThreshold", "labelledAccounts", "scoredAccounts", "labelledEstimates",
             "holdoutAccuracy", "holdoutCoverage", "mtnHoldoutAccuracy", "predictedFemaleShare", "actualFemaleShare"
      FROM gender_estimate_runs ORDER BY "runAt" DESC LIMIT 1`;
    return run ?? null;
  }

  private static async loadPersonalAccounts(): Promise<NamedAccount[]> {
    return prisma.$queryRaw<NamedAccount[]>`
      SELECT ap.id AS "profileId", c."clientName" AS name, ap.gender::text AS gender, ap."signupChannel" AS "signupChannel"
      FROM account_profiles ap
      JOIN accounts a ON a.id = ap."accountId"
      JOIN clients c ON c.id = a."clientId"
      WHERE a."accountType" = 'PERSONAL'`;
  }

  /**
   * Trains on 80% of declared accounts and scores the other 20% (a fixed, seeded
   * split so runs are comparable). Reports accuracy and coverage at each threshold,
   * accuracy for MTN sign-ups alone, and whether probability-weighted totals
   * reproduce the declared female share.
   */
  private static validateOnHoldout(labelled: NamedAccount[]): GenderEstimateReport['holdout'] {
    const shuffled = shuffleWithSeed(labelled, HOLDOUT_SEED);
    const cut = Math.floor(shuffled.length * (1 - HOLDOUT_SHARE));
    const model = NameGenderModel.train(shuffled.slice(0, cut));
    const scored = shuffled
      .slice(cut)
      .map((a) => ({ ...a, femaleProbability: model.femaleProbability(a.name) }));
    const total = scored.length;

    const measure = (rows: typeof scored, threshold: number): ThresholdMetrics => {
      let covered = 0;
      let correct = 0;
      for (const r of rows) {
        if (r.femaleProbability === null) continue;
        const label = confidentGender(r.femaleProbability, threshold);
        if (!label) continue;
        covered++;
        if (label === r.gender) correct++;
      }
      return { threshold, coverage: rows.length ? covered / rows.length : 0, accuracy: covered ? correct / covered : 0 };
    };

    const withProbability = scored.filter((r) => r.femaleProbability !== null);
    const mtn = scored.filter((r) => r.signupChannel === 'MTN');
    const atThreshold = measure(scored, GENDER_CONFIDENCE_THRESHOLD);
    return {
      accounts: total,
      accuracy: atThreshold.accuracy,
      coverage: atThreshold.coverage,
      mtnAccounts: mtn.length,
      mtnAccuracy: mtn.length ? measure(mtn, GENDER_CONFIDENCE_THRESHOLD).accuracy : null,
      predictedFemaleShare: withProbability.length
        ? withProbability.reduce((s, r) => s + (r.femaleProbability as number), 0) / withProbability.length
        : 0,
      actualFemaleShare: withProbability.length
        ? withProbability.filter((r) => r.gender === 'FEMALE').length / withProbability.length
        : 0,
      byThreshold: REPORTED_THRESHOLDS.map((t) => measure(scored, t)),
    };
  }

  /**
   * Replaces all estimates in one transaction: clears previous ones (so accounts that
   * have since declared a gender lose theirs), then writes the new probabilities in batches.
   */
  private static async writeEstimates(estimates: Array<{ profileId: string; femaleProbability: number }>): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          UPDATE account_profiles
          SET "estimatedGender" = NULL, "estimatedFemaleProbability" = NULL, "genderEstimateModel" = NULL, "genderEstimatedAt" = NULL
          WHERE "estimatedFemaleProbability" IS NOT NULL OR "estimatedGender" IS NOT NULL`;

        for (let i = 0; i < estimates.length; i += WRITE_BATCH_SIZE) {
          const values = estimates
            .slice(i, i + WRITE_BATCH_SIZE)
            .map((e) => Prisma.sql`(${e.profileId}, ${e.femaleProbability}::float8, ${confidentGender(e.femaleProbability)}::text)`);
          await tx.$executeRaw`
            UPDATE account_profiles ap
            SET "estimatedFemaleProbability" = v.p,
                "estimatedGender" = v.g::"Gender",
                "genderEstimateModel" = ${GENDER_MODEL_VERSION},
                "genderEstimatedAt" = NOW()
            FROM (VALUES ${Prisma.join(values)}) AS v(id, p, g)
            WHERE ap.id = v.id`;
        }
      },
      { timeout: 300000 }
    );
  }
}

/** Fisher-Yates shuffle with a small deterministic generator, so the hold-out split is repeatable. */
function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
