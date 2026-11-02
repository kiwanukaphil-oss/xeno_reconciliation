import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { InsightSegment, MIN_REPORTABLE_GROUP_SIZE } from './ClientInsightsService';

/** Goals with a plausible target, i.e. the base for every achievement rate. */
const TARGETED_STATUSES = `('REACHED_HOLDING', 'REACHED_USED', 'NOT_STARTED', 'IN_PROGRESS')`;
const UNKNOWN_KEY = 'UNKNOWN';

export interface AchievementRow {
  key: string;
  goals: number; // probability-weighted for gender
  everReached: number;
  reachedHolding: number;
  reachedUsed: number;
  everReachedRate: number | null;
  reachedUsedRate: number | null;
  medianProgress: number | null; // in-progress goals only
  medianTarget: number | null;
}

export interface AchievementBreakdown {
  dimension: string;
  label: string;
  weighted?: boolean;
  rows: AchievementRow[];
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
   * across Ultima snapshots.
   */
  static async getReport(segment: InsightSegment) {
    const where = this.segmentCondition(segment);
    const [headline, statuses, progressBands, paceBands, targetSetting, trend, breakdowns, gender] = await Promise.all([
      this.getHeadline(where),
      this.countByColumn(where, 'status', Prisma.sql`TRUE`),
      this.countByColumn(where, 'progress_band', Prisma.sql`ga.status = 'IN_PROGRESS'`),
      this.countByColumn(where, 'pace_band', Prisma.sql`ga.status = 'IN_PROGRESS'`),
      this.getTargetSettingComparison(where),
      this.getSnapshotTrend(segment),
      Promise.all(DIMENSIONS.map((d) => this.getBreakdown(d, where))),
      this.getWeightedGenderBreakdown(where),
    ]);
    return {
      segment,
      asOf: { ultimaSnapshot: headline.snapshot_as_of, transactions: headline.data_as_of },
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

  private static async getHeadline(where: Prisma.Sql) {
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
      FROM goal_achievement ga
      WHERE ${where}`;
    return row;
  }

  /** Goals and Ultima value per value of one view column (fixed column names only). */
  private static async countByColumn(where: Prisma.Sql, column: 'status' | 'progress_band' | 'pace_band', filter: Prisma.Sql) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(`ga.${column}`)} AS key, COUNT(*)::int AS goals, COALESCE(SUM(ga.ultima_value), 0)::float8 AS value
      FROM goal_achievement ga
      WHERE ${where} AND ${filter} AND ga.in_ultima
      GROUP BY 1 ORDER BY 1`;
    const total = rows.reduce((s, r) => s + r.goals, 0);
    return rows.map((r) => ({ key: r.key, goals: r.goals, value: r.value, share: ratio(r.goals, total) }));
  }

  /** Do clients who set a target save differently from those who don't? */
  private static async getTargetSettingComparison(where: Prisma.Sql) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT CASE WHEN ga.goal_target > 0 THEN 'WITH_TARGET' ELSE 'NO_TARGET' END AS key,
             COUNT(*)::int AS goals,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.ultima_value)::float8 AS median_value,
             COUNT(*) FILTER (WHERE ga.deposits_12m > 0)::int AS saving_12m,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.deposits_12m) FILTER (WHERE ga.deposits_12m > 0)::float8 AS median_deposits_12m,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.deposit_amount_12m) FILTER (WHERE ga.deposits_12m > 0)::float8 AS median_amount_12m
      FROM goal_achievement ga
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
   */
  private static async getSnapshotTrend(segment: InsightSegment) {
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
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({ asOf: r.as_of, goalsWithTarget: r.targeted, atTarget: r.at_target, atTargetRate: ratio(r.at_target, r.targeted) }));
  }

  /**
   * Achievement rates for one dimension over goals with a plausible target.
   * Groups under the minimum size are folded into one row; Unknown comes last.
   */
  private static async getBreakdown(definition: AchievementDimension, where: Prisma.Sql): Promise<AchievementBreakdown> {
    const raw = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(definition.expression)} AS key,
             COUNT(*)::int AS goals,
             COUNT(*) FILTER (WHERE ga.status IN ('REACHED_HOLDING', 'REACHED_USED'))::int AS ever_reached,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_HOLDING')::int AS reached_holding,
             COUNT(*) FILTER (WHERE ga.status = 'REACHED_USED')::int AS reached_used,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.progress) FILTER (WHERE ga.status = 'IN_PROGRESS')::float8 AS median_progress,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ga.goal_target)::float8 AS median_target
      FROM goal_achievement ga
      LEFT JOIN account_profile_aum v ON v.account_id = ga.account_id
      WHERE ${where} AND ga.status IN ${Prisma.raw(TARGETED_STATUSES)}
      GROUP BY 1`;

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
    if (small.length) shown.push(foldRows(`Other (groups under ${MIN_REPORTABLE_GROUP_SIZE})`, small));
    if (unknown.length) shown.push(foldRows(UNKNOWN_KEY, unknown));
    return { dimension: definition.dimension, label: definition.label, rows: shown };
  }

  /**
   * Achievement by gender, probability-weighted like the other gender headlines:
   * each goal counts towards Female and Male in proportion to the holder's female
   * probability (declared = 1 or 0). Goals whose holder has no gender estimate are
   * reported separately.
   */
  private static async getWeightedGenderBreakdown(where: Prisma.Sql): Promise<AchievementBreakdown> {
    const [r] = await prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(SUM(v.female_probability), 0)::float8 AS f_goals,
        COALESCE(SUM(v.female_probability) FILTER (WHERE ga.status IN ('REACHED_HOLDING', 'REACHED_USED')), 0)::float8 AS f_reached,
        COALESCE(SUM(v.female_probability) FILTER (WHERE ga.status = 'REACHED_HOLDING'), 0)::float8 AS f_holding,
        COALESCE(SUM(v.female_probability) FILTER (WHERE ga.status = 'REACHED_USED'), 0)::float8 AS f_used,
        COALESCE(SUM(1 - v.female_probability), 0)::float8 AS m_goals,
        COALESCE(SUM(1 - v.female_probability) FILTER (WHERE ga.status IN ('REACHED_HOLDING', 'REACHED_USED')), 0)::float8 AS m_reached,
        COALESCE(SUM(1 - v.female_probability) FILTER (WHERE ga.status = 'REACHED_HOLDING'), 0)::float8 AS m_holding,
        COALESCE(SUM(1 - v.female_probability) FILTER (WHERE ga.status = 'REACHED_USED'), 0)::float8 AS m_used,
        COUNT(*) FILTER (WHERE v.female_probability IS NULL)::int AS u_goals,
        COUNT(*) FILTER (WHERE v.female_probability IS NULL AND ga.status IN ('REACHED_HOLDING', 'REACHED_USED'))::int AS u_reached,
        COUNT(*) FILTER (WHERE v.female_probability IS NULL AND ga.status = 'REACHED_HOLDING')::int AS u_holding,
        COUNT(*) FILTER (WHERE v.female_probability IS NULL AND ga.status = 'REACHED_USED')::int AS u_used
      FROM goal_achievement ga
      LEFT JOIN account_profile_aum v ON v.account_id = ga.account_id
      WHERE ${where} AND ga.status IN ${Prisma.raw(TARGETED_STATUSES)}`;

    const row = (key: string, goals: number, reached: number, holding: number, used: number): AchievementRow => ({
      key,
      goals,
      everReached: reached,
      reachedHolding: holding,
      reachedUsed: used,
      everReachedRate: ratio(reached, goals),
      reachedUsedRate: ratio(used, goals),
      medianProgress: null,
      medianTarget: null,
    });
    const rows = [
      row('FEMALE', r.f_goals, r.f_reached, r.f_holding, r.f_used),
      row('MALE', r.m_goals, r.m_reached, r.m_holding, r.m_used),
    ];
    if (r.u_goals >= MIN_REPORTABLE_GROUP_SIZE) rows.push(row('Not estimable', r.u_goals, r.u_reached, r.u_holding, r.u_used));
    return { dimension: 'gender', label: 'Gender (declared or estimated, probability-weighted)', weighted: true, rows };
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
