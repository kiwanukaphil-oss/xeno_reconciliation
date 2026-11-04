import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { InsightSegment, MIN_REPORTABLE_GROUP_SIZE } from './ClientInsightsService';
import { InsightSources, LATEST_SOURCES } from './InsightSources';
import {
  addGenderTallies,
  allocateMeasure,
  describeGenderView,
  GenderSplit,
  genderTallySql,
  GenderView,
  readGenderTally,
  splitGender,
} from './GenderAllocation';

/** Goals with a plausible target, i.e. the base for every achievement rate. */
const TARGETED_STATUSES = `('REACHED_HOLDING', 'REACHED_USED', 'NOT_STARTED', 'IN_PROGRESS')`;
const UNKNOWN_KEY = 'UNKNOWN';
const EVER_REACHED_SQL = `CASE WHEN ga.status IN ('REACHED_HOLDING', 'REACHED_USED') THEN 1 ELSE 0 END`;

export interface AchievementRow {
  key: string;
  goals: number; // allocated (fractional) for gender rows in ALLOCATED view
  everReached: number;
  reachedHolding: number;
  reachedUsed: number;
  everReachedRate: number | null;
  reachedUsedRate: number | null;
  medianProgress: number | null; // in-progress goals only
  medianTarget: number | null;
  /** Female/male split of the row: count = goals, value = goals that reached their target. */
  gender?: GenderSplit;
}

export interface AchievementBreakdown {
  dimension: string;
  label: string;
  /** Set where figures are allocated rather than counted, to say how. */
  note?: string;
  rows: AchievementRow[];
}

export interface CountRow {
  key: string;
  goals: number;
  value: number;
  share: number | null;
  /** Female/male split of the row: count = goals, value = Ultima goal value. */
  gender: GenderSplit;
}

interface AchievementDimension {
  dimension: string;
  label: string;
  expression: string; // fixed SQL over goal_achievement (ga) and account_profile_aum (v) - never user input
  ordered?: boolean; // natural order (bands) rather than by size
}

const DIMENSIONS: AchievementDimension[] = [
  { dimension: 'targetSize', label: 'Target size (UGX)', expression: 'ga.target_band', ordered: true },
  { dimension: 'goalCategory', label: 'Goal category', expression: 'ga.goal_category' },
  { dimension: 'riskScore', label: 'Risk score', expression: `COALESCE(ga.risk_score::text, '${UNKNOWN_KEY}')`, ordered: true },
  { dimension: 'signupChannel', label: 'Sign-up channel', expression: `COALESCE(v.signup_channel, '${UNKNOWN_KEY}')` },
  { dimension: 'locationGroup', label: 'Location', expression: `COALESCE(v.location_group, '${UNKNOWN_KEY}')` },
  { dimension: 'ageBand', label: 'Age band', expression: `COALESCE(v.age_band, '${UNKNOWN_KEY}')`, ordered: true },
];

const AGE_BAND_ORDER = ['Under 18', '18-25', '26-35', '36-45', '46-55', '56-65', '65+'];

/**
 * Goal achievement against Ultima goal targets, over the goal_achievement view.
 * "Ever reached" counts goals whose value is at target now (reached and holding)
 * plus goals whose net deposits reached the target before money was withdrawn
 * (reached and used, e.g. school fees saved and paid). Rates are over goals
 * with a plausible target (UGX 10k to 10bn).
 */
export class GoalAchievementService {
  static segmentCondition(segment: InsightSegment): Prisma.Sql {
    return segment === 'ALL' ? Prisma.sql`TRUE` : Prisma.sql`ga.segment = ${segment}`;
  }

  /**
   * Everything the Goal Achievement page shows for one segment: headline rates,
   * status counts, progress and pace of goals still on the way, how goals with and
   * without targets behave, breakdowns by goal and client profile, and the trend
   * across Ultima snapshots. For a past as-at date, goal values and deposit counts come from the
   * goal's own transactions at that date's prices (targets are Ultima's current ones).
   */
  static async getReport(segment: InsightSegment, genderView: GenderView = 'IDENTIFIED', sources: InsightSources = LATEST_SOURCES) {
    const where = this.segmentCondition(segment);
    const [headline, statuses, progressBands, paceBands, targetSetting, trend, breakdowns, gender] = await Promise.all([
      this.getHeadline(where, sources),
      this.countByColumn(where, 'status', Prisma.sql`TRUE`, genderView, sources),
      this.countByColumn(where, 'progress_band', Prisma.sql`ga.status = 'IN_PROGRESS'`, genderView, sources),
      this.countByColumn(where, 'pace_band', Prisma.sql`ga.status = 'IN_PROGRESS'`, genderView, sources),
      this.getTargetSettingComparison(where, sources),
      this.getSnapshotTrend(segment, sources),
      Promise.all(DIMENSIONS.map((d) => this.getBreakdown(d, where, genderView, sources))),
      this.getGenderBreakdown(where, genderView, sources),
    ]);
    return {
      segment,
      genderView,
      genderNote: describeGenderView(genderView),
      asOf: {
        snapshot: sources.asOf,
        ultimaSnapshot: headline.snapshot_as_of,
        transactions: headline.data_as_of,
        // Where goal values come from: Ultima Goal Stats (Latest) or the system's own transactions (past dates)
        valueBasis: sources.asOf === null ? 'ULTIMA' : 'SYSTEM',
      },
      headline: {
        goals: headline.goals,
        goalsWithTarget: headline.with_target,
        goalsWithPlausibleTarget: headline.targeted,
        everReached: headline.ever_reached,
        reachedHolding: headline.reached_holding,
        reachedUsed: headline.reached_used,
        inProgress: headline.in_progress,
        targetSettingRate: ratio(headline.with_target, headline.goals),
        everReachedRate: ratio(headline.ever_reached, headline.targeted),
        reachedHoldingRate: ratio(headline.reached_holding, headline.targeted),
        reachedUsedRate: ratio(headline.reached_used, headline.targeted),
      },
      statuses,
      progressBands,
      paceBands,
      targetSetting,
      trend,
      breakdowns: [...breakdowns.slice(0, 3), gender, ...breakdowns.slice(3)],
    };
  }

  private static async getHeadline(where: Prisma.Sql, sources: InsightSources) {
    const [row] = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) FILTER (WHERE ga.in_ultima)::int AS goals,
             COUNT(*) FILTER (WHERE ga.goal_target > 0)::int AS with_target,
             COUNT(*) FILTER (WHERE ga.status IN ${Prisma.raw(TARGETED_STATUSES)})::int AS targeted,
             COUNT(*) FILTER (WHERE ga.status IN ('REACHED_HOLDING', 'REACHED_USED'))::int AS ever_reached,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_HOLDING')::int AS reached_holding,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_USED')::int AS reached_used,
             COUNT(*) FILTER (WHERE ga.status = 'IN_PROGRESS')::int AS in_progress,
             MIN(ga.snapshot_as_of)::text AS snapshot_as_of,
             MIN(ga.data_as_of)::text AS data_as_of
      FROM ${sources.goalAchievement('ga')}
      WHERE ${where}`;
    return row;
  }

  /**
   * Goals and Ultima value per value of one view column (fixed column names only),
   * each with its female/male split (rows with few identified holders use the ratio
   * across all rows).
   */
  private static async countByColumn(
    where: Prisma.Sql,
    column: 'status' | 'progress_band' | 'pace_band',
    filter: Prisma.Sql,
    genderView: GenderView,
    sources: InsightSources
  ): Promise<CountRow[]> {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(`ga.${column}`)} AS key, COUNT(*)::int AS goals, COALESCE(SUM(ga.ultima_value), 0)::float8 AS value,
             ${Prisma.raw(genderTallySql('v.gender', 'ga.ultima_value'))}
      FROM ${sources.goalAchievement('ga')}
      LEFT JOIN ${sources.accounts('v')} ON v.account_id = ga.account_id
      WHERE ${where} AND ${filter} AND ga.in_ultima
      GROUP BY 1 ORDER BY 1`;
    const total = rows.reduce((s, r) => s + r.goals, 0);
    const baseTally = addGenderTallies(rows.map(readGenderTally));
    return rows.map((r) => ({
      key: r.key,
      goals: r.goals,
      value: r.value,
      share: ratio(r.goals, total),
      gender: splitGender(readGenderTally(r), genderView, baseTally),
    }));
  }

  /** Do clients who set a target save differently from those who don't? */
  private static async getTargetSettingComparison(where: Prisma.Sql, sources: InsightSources) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT CASE WHEN ga.goal_target > 0 THEN 'WITH_TARGET' ELSE 'NO_TARGET' END AS key,
             COUNT(*)::int AS goals,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.ultima_value)::float8 AS median_value,
             COUNT(*) FILTER (WHERE ga.deposits_12m > 0)::int AS saving_12m,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.deposits_12m) FILTER (WHERE ga.deposits_12m > 0)::float8 AS median_deposits_12m,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.deposit_amount_12m) FILTER (WHERE ga.deposits_12m > 0)::float8 AS median_amount_12m
      FROM ${sources.goalAchievement('ga')}
      WHERE ${where} AND ga.in_ultima
      GROUP BY 1 ORDER BY 1 DESC`;
    return rows.map((r) => ({
      key: r.key,
      goals: r.goals,
      medianValue: r.median_value,
      savedInLast12MonthsRate: ratio(r.saving_12m, r.goals),
      medianDepositsLast12Months: r.median_deposits_12m,
      medianAmountLast12Months: r.median_amount_12m,
    }));
  }

  /**
   * Goals at target in each Ultima snapshot. Only "reached and holding" can be
   * seen per snapshot; the trend grows as monthly Goal Stats exports are imported.
   * For a past as-at date, only Ultima snapshots up to that date are included.
   */
  private static async getSnapshotTrend(segment: InsightSegment, sources: InsightSources) {
    const segmentFilter =
      segment === 'ALL'
        ? Prisma.empty
        : Prisma.sql`AND (CASE WHEN a."accountType"::text IN ('PERSONAL', 'JOINT') THEN 'INDIVIDUAL' ELSE 'INSTITUTIONAL' END) = ${segment}`;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT s."asOfDate"::text AS as_of,
             COUNT(*) FILTER (WHERE s."goalTarget" >= 10000 AND s."goalTarget" < 10000000000)::int AS targeted,
             COUNT(*) FILTER (WHERE s."goalTarget" >= 10000 AND s."goalTarget" < 10000000000 AND s."currentValue" >= s."goalTarget")::int AS at_target
      FROM ultima_goal_snapshots s
      JOIN goals g ON g.id = s."goalId"
      JOIN accounts a ON a.id = g."accountId"
      WHERE TRUE ${segmentFilter}
        ${sources.asOf === null ? Prisma.empty : Prisma.sql`AND s."asOfDate" <= ${sources.asOf}::date`}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({ asOf: r.as_of, goalsWithTarget: r.targeted, atTarget: r.at_target, atTargetRate: ratio(r.at_target, r.targeted) }));
  }

  /**
   * Achievement rates for one dimension over goals with a plausible target.
   * Groups under the minimum size are folded into one row; Unknown comes last.
   */
  private static async getBreakdown(
    definition: AchievementDimension,
    where: Prisma.Sql,
    genderView: GenderView,
    sources: InsightSources
  ): Promise<AchievementBreakdown> {
    const raw = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(definition.expression)} AS key,
             COUNT(*)::int AS goals,
             COUNT(*) FILTER (WHERE ga.status IN ('REACHED_HOLDING', 'REACHED_USED'))::int AS ever_reached,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_HOLDING')::int AS reached_holding,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_USED')::int AS reached_used,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.progress) FILTER (WHERE ga.status = 'IN_PROGRESS')::float8 AS median_progress,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.goal_target)::float8 AS median_target,
             ${Prisma.raw(genderTallySql('v.gender', EVER_REACHED_SQL))}
      FROM ${sources.goalAchievement('ga')}
      LEFT JOIN ${sources.accounts('v')} ON v.account_id = ga.account_id
      WHERE ${where} AND ga.status IN ${Prisma.raw(TARGETED_STATUSES)}
      GROUP BY 1`;

    const baseTally = addGenderTallies(raw.map(readGenderTally));
    const genderOf = (group: any[]) => splitGender(addGenderTallies(group.map(readGenderTally)), genderView, baseTally);
    const toRow = (r: any): AchievementRow => ({
      key: String(r.key ?? UNKNOWN_KEY),
      goals: r.goals,
      everReached: r.ever_reached,
      reachedHolding: r.reached_holding,
      reachedUsed: r.reached_used,
      everReachedRate: ratio(r.ever_reached, r.goals),
      reachedUsedRate: ratio(r.reached_used, r.goals),
      medianProgress: r.median_progress,
      medianTarget: r.median_target,
      gender: genderOf([r]),
    });
    const known = raw.filter((r) => r.key !== null && r.key !== UNKNOWN_KEY);
    const unknown = raw.filter((r) => r.key === null || r.key === UNKNOWN_KEY);
    known.sort((a, b) => {
      if (definition.dimension === 'ageBand') return AGE_BAND_ORDER.indexOf(a.key) - AGE_BAND_ORDER.indexOf(b.key);
      if (definition.dimension === 'riskScore') return Number(a.key) - Number(b.key);
      return definition.ordered ? String(a.key).localeCompare(String(b.key)) : b.goals - a.goals;
    });

    const shown = known.filter((r) => r.goals >= MIN_REPORTABLE_GROUP_SIZE).map(toRow);
    const small = known.filter((r) => r.goals < MIN_REPORTABLE_GROUP_SIZE);
    if (small.length) shown.push({ ...foldRows(`Other (groups under ${MIN_REPORTABLE_GROUP_SIZE})`, small), gender: genderOf(small) });
    if (unknown.length) shown.push({ ...foldRows(UNKNOWN_KEY, unknown), gender: genderOf(unknown) });
    return { dimension: definition.dimension, label: definition.label, rows: shown };
  }

  /**
   * Achievement by the holder's declared gender. IDENTIFIED: Female and Male goals only.
   * ALLOCATED: goals of holders without a declared gender are split between Female and
   * Male, each count (goals, reached, holding, used) in its own identified ratio, so
   * the rates are those a proportional split implies. Medians are of identified goals.
   */
  static async getGenderBreakdown(where: Prisma.Sql, genderView: GenderView, sources: InsightSources): Promise<AchievementBreakdown> {
    const raw = await prisma.$queryRaw<any[]>`
      SELECT CASE WHEN v.gender IN ('FEMALE', 'MALE') THEN v.gender ELSE 'UNKNOWN' END AS key,
             COUNT(*)::int AS goals,
             COUNT(*) FILTER (WHERE ga.status IN ('REACHED_HOLDING', 'REACHED_USED'))::int AS ever_reached,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_HOLDING')::int AS reached_holding,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_USED')::int AS reached_used,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.progress) FILTER (WHERE ga.status = 'IN_PROGRESS')::float8 AS median_progress,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.goal_target)::float8 AS median_target
      FROM ${sources.goalAchievement('ga')}
      LEFT JOIN ${sources.accounts('v')} ON v.account_id = ga.account_id
      WHERE ${where} AND ga.status IN ${Prisma.raw(TARGETED_STATUSES)}
      GROUP BY 1`;
    const empty = { goals: 0, ever_reached: 0, reached_holding: 0, reached_used: 0, median_progress: null, median_target: null };
    const byKey = (key: string) => raw.find((r) => r.key === key) ?? empty;
    const [f, m, u] = [byKey('FEMALE'), byKey('MALE'), byKey(UNKNOWN_KEY)];
    const measure = (field: 'goals' | 'ever_reached' | 'reached_holding' | 'reached_used') =>
      allocateMeasure(f[field], m[field], u[field], genderView);
    const [goals, reached, holding, used] = [measure('goals'), measure('ever_reached'), measure('reached_holding'), measure('reached_used')];

    const row = (key: 'FEMALE' | 'MALE', source: any): AchievementRow => {
      const side = key === 'FEMALE' ? 'female' : 'male';
      return {
        key,
        goals: goals[side],
        everReached: reached[side],
        reachedHolding: holding[side],
        reachedUsed: used[side],
        everReachedRate: ratio(reached[side], goals[side]),
        reachedUsedRate: ratio(used[side], goals[side]),
        medianProgress: source.median_progress,
        medianTarget: source.median_target,
      };
    };
    return {
      dimension: 'gender',
      label: genderView === 'IDENTIFIED' ? 'Gender (identified holders)' : 'Gender (all goals, unidentified allocated)',
      note:
        genderView === 'IDENTIFIED'
          ? `${Math.round(u.goals).toLocaleString('en-US')} goals whose holder has no declared gender are left out.`
          : `${Math.round(u.goals).toLocaleString('en-US')} goals whose holder has no declared gender are split in the identified ratio, so goal counts are estimates. Medians are of identified holders.`,
      rows: [row('FEMALE', f), row('MALE', m)].filter((r) => r.goals >= MIN_REPORTABLE_GROUP_SIZE),
    };
  }
}

/** Combines small or unknown groups into one row (medians cannot be combined, so they are left out). */
function foldRows(key: string, rows: any[]): AchievementRow {
  const goals = rows.reduce((s, r) => s + r.goals, 0);
  const everReached = rows.reduce((s, r) => s + r.ever_reached, 0);
  const reachedUsed = rows.reduce((s, r) => s + r.reached_used, 0);
  return {
    key,
    goals,
    everReached,
    reachedHolding: rows.reduce((s, r) => s + r.reached_holding, 0),
    reachedUsed,
    everReachedRate: ratio(everReached, goals),
    reachedUsedRate: ratio(reachedUsed, goals),
    medianProgress: rows.length === 1 ? rows[0].median_progress : null,
    medianTarget: rows.length === 1 ? rows[0].median_target : null,
  };
}

function ratio(part: number, whole: number): number | null {
  return whole ? part / whole : null;
}
