import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ClientInsightsService, InsightSegment, MIN_REPORTABLE_GROUP_SIZE } from './ClientInsightsService';
import { InsightSources, LATEST_SOURCES } from './InsightSources';
import {
  addGenderTallies,
  describeGenderView,
  EMPTY_TALLY,
  GenderTally,
  genderTallySql,
  GenderView,
  readGenderTally,
  splitGender,
} from './GenderAllocation';

/** A goal is "drifted" when any fund's actual share is this many percentage points from target. */
export const DRIFT_TOLERANCE_PP = 10;

/**
 * Suitability review rules. These flag goals/accounts for a human to look at;
 * they are not judgements. Thresholds are deliberately simple and listed in the UI.
 */
export const SUITABILITY_RULES = {
  OLDER_HIGH_EQUITY: { label: 'Aged 60+ with 30%+ in equity funds', minAge: 60, minEquityPct: 30 },
  EQUITY_WITHOUT_ASSESSMENT: { label: 'No risk score (0) but 10%+ in equity funds', minEquityPct: 10 },
  EQUITY_ABOVE_TARGET: { label: 'Equity share 15+ points above target', minGapPp: 15 },
  YOUNG_LARGE_BALANCE: { label: 'Under 25 with a balance of UGX 50m+', maxAge: 25, minBalance: 50_000_000 },
} as const;
export type SuitabilityRule = keyof typeof SUITABILITY_RULES;

const SPLIT_COLUMNS = Prisma.raw(`
  xummf_pct::float8, xubf_pct::float8, xudef_pct::float8, xuref_pct::float8,
  target_xummf_pct::float8, target_xubf_pct::float8, target_xudef_pct::float8, target_xuref_pct::float8`);

/**
 * Goal categories in the Breakdown shape used by Client Composition (so the same
 * bar list renders them). Here "accounts" carries the number of goals. Categories
 * with fewer than the minimum number of goals are folded into one row.
 */
function buildGoalCategoryBreakdown(byCategory: any[], genderView: GenderView, genderTallies: Map<string, GenderTally>) {
  const baseTally = addGenderTallies([...genderTallies.values()]);
  const genderOf = (categories: any[]) =>
    splitGender(addGenderTallies(categories.map((c) => genderTallies.get(String(c.goal_category)) ?? EMPTY_TALLY)), genderView, baseTally);
  const totalGoals = byCategory.reduce((s, r) => s + r.goals, 0);
  const totalValue = byCategory.reduce((s, r) => s + r.value, 0);
  const toRow = (key: string, goals: number, value: number, median: number | null, categories: any[]) => ({
    key,
    accounts: goals,
    aum: value,
    shareOfAccounts: totalGoals ? goals / totalGoals : 0,
    shareOfAum: totalValue ? value / totalValue : 0,
    medianBalance: median,
    averageBalance: goals ? value / goals : null,
    gender: genderOf(categories),
  });

  const shown = byCategory.filter((r) => r.goals >= MIN_REPORTABLE_GROUP_SIZE);
  const folded = byCategory.filter((r) => r.goals < MIN_REPORTABLE_GROUP_SIZE);
  const rows = shown.map((r) => toRow(r.goal_category, r.goals, r.value, r.median_value, [r]));
  if (folded.length) {
    rows.push(toRow(`Other (categories under ${MIN_REPORTABLE_GROUP_SIZE} goals)`,
      folded.reduce((s, r) => s + r.goals, 0), folded.reduce((s, r) => s + r.value, 0), null, folded));
  }
  return { dimension: 'goalCategory', label: 'Goal category', knownShareOfAccounts: 1, knownShareOfAum: 1, rows };
}

const toSplit = (r: any, prefix: '' | 'target_') => ({
  XUMMF: r[`${prefix}xummf_pct`],
  XUBF: r[`${prefix}xubf_pct`],
  XUDEF: r[`${prefix}xudef_pct`],
  XUREF: r[`${prefix}xuref_pct`],
});

/**
 * Risk and allocation reporting over the goal_holdings view: AUM by risk score and
 * goal category, drift of actual holdings from Ultima's target split, and a
 * suitability review list. Covers funded goals (value >= UGX 5,000).
 */
export class GoalRiskService {
  /**
   * Risk score, goal category and drift summaries plus the largest drifted goals.
   * Risk score and goal category rows carry a female/male split (count = goals,
   * value = goal value) by the holder's declared gender, under genderView.
   */
  static async getRiskAllocation(
    segment: InsightSegment,
    limit: number,
    genderView: GenderView = 'IDENTIFIED',
    sources: InsightSources = LATEST_SOURCES
  ) {
    const where = ClientInsightsService.segmentCondition(segment);
    const goals = sources.goalHoldings();
    const [riskGender, categoryGender] = await Promise.all([
      this.tallyGenderBy('gh.risk_score', segment, sources),
      this.tallyGenderBy('gh.goal_category', segment, sources),
    ]);
    const riskBaseTally = addGenderTallies([...riskGender.values()]);

    const byRiskScore = await prisma.$queryRaw<any[]>`
      SELECT risk_score, COUNT(*)::int AS goals, SUM(total_value)::float8 AS value,
             (100 * SUM(xudef_value + xuref_value) / NULLIF(SUM(total_value), 0))::float8 AS actual_equity_pct,
             (SUM(target_equity_pct * total_value) / NULLIF(SUM(total_value) FILTER (WHERE target_equity_pct IS NOT NULL), 0))::float8 AS target_equity_pct
      FROM ${goals} WHERE is_funded AND ${where}
      GROUP BY risk_score ORDER BY risk_score NULLS FIRST`;

    const byCategory = await prisma.$queryRaw<any[]>`
      SELECT goal_category, COUNT(*)::int AS goals, SUM(total_value)::float8 AS value,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY total_value)::float8 AS median_value,
             (100 * SUM(xudef_value + xuref_value) / NULLIF(SUM(total_value), 0))::float8 AS actual_equity_pct
      FROM ${goals} WHERE is_funded AND ${where}
      GROUP BY goal_category ORDER BY value DESC`;

    const driftBands = await prisma.$queryRaw<any[]>`
      SELECT CASE
          WHEN drift_pp IS NULL THEN '5. No target split'
          WHEN drift_pp < 5 THEN '1. Under 5 points'
          WHEN drift_pp < ${DRIFT_TOLERANCE_PP} THEN '2. 5-10 points'
          WHEN drift_pp < 20 THEN '3. 10-20 points'
          ELSE '4. 20+ points' END AS band,
        COUNT(*)::int AS goals, SUM(total_value)::float8 AS value
      FROM ${goals} WHERE is_funded AND ${where}
      GROUP BY 1 ORDER BY 1`;

    // Value-weighted average gap per fund among drifted goals: shows which way holdings lean
    const [direction] = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS goals, COALESCE(SUM(total_value), 0)::float8 AS value,
        (SUM((xummf_pct - target_xummf_pct) * total_value) / NULLIF(SUM(total_value), 0))::float8 AS xummf_gap,
        (SUM((xubf_pct - target_xubf_pct) * total_value) / NULLIF(SUM(total_value), 0))::float8 AS xubf_gap,
        (SUM((xudef_pct - target_xudef_pct) * total_value) / NULLIF(SUM(total_value), 0))::float8 AS xudef_gap,
        (SUM((xuref_pct - target_xuref_pct) * total_value) / NULLIF(SUM(total_value), 0))::float8 AS xuref_gap
      FROM ${goals} WHERE is_funded AND ${where} AND drift_pp >= ${DRIFT_TOLERANCE_PP}`;

    const largestDrifted = await prisma.$queryRaw<any[]>`
      SELECT goal_number, account_number, account_type, goal_category, risk_score,
             total_value::float8 AS value, drift_pp::float8 AS drift_pp, ${SPLIT_COLUMNS}
      FROM ${goals} WHERE is_funded AND ${where} AND drift_pp >= ${DRIFT_TOLERANCE_PP}
      ORDER BY total_value DESC LIMIT ${limit}`;

    const [issues] = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) FILTER (WHERE xummf_pct < 0 OR xubf_pct < 0 OR xudef_pct < 0 OR xuref_pct < 0)::int AS negative_fund_balance,
             COUNT(*) FILTER (WHERE target_xummf_pct IS NULL)::int AS no_target_split
      FROM ${goals} WHERE is_funded AND ${where}`;

    const totalValue = byRiskScore.reduce((s, r) => s + r.value, 0);

    return {
      segment,
      asOf: sources.asOf,
      driftTolerancePp: DRIFT_TOLERANCE_PP,
      totalValue,
      byRiskScore: byRiskScore.map((r) => ({
        riskScore: r.risk_score,
        goals: r.goals,
        value: r.value,
        shareOfValue: totalValue ? r.value / totalValue : 0,
        actualEquityPct: r.actual_equity_pct,
        targetEquityPct: r.target_equity_pct,
        gender: splitGender(riskGender.get(String(r.risk_score)) ?? EMPTY_TALLY, genderView, riskBaseTally),
      })),
      byGoalCategory: buildGoalCategoryBreakdown(byCategory, genderView, categoryGender),
      genderView,
      genderNote: describeGenderView(genderView),
      driftBands: driftBands.map((b) => ({ band: b.band, goals: b.goals, value: b.value, shareOfValue: totalValue ? b.value / totalValue : 0 })),
      driftDirection: {
        goals: direction.goals,
        value: direction.value,
        averageGapPp: { XUMMF: direction.xummf_gap, XUBF: direction.xubf_gap, XUDEF: direction.xudef_gap, XUREF: direction.xuref_gap },
      },
      largestDriftedGoals: largestDrifted.map((r) => ({
        goalNumber: r.goal_number,
        accountNumber: r.account_number,
        accountType: r.account_type,
        goalCategory: r.goal_category,
        riskScore: r.risk_score,
        value: r.value,
        driftPp: r.drift_pp,
        actualSplit: toSplit(r, ''),
        targetSplit: toSplit(r, 'target_'),
      })),
      dataIssues: {
        goalsWithNegativeFundBalance: issues.negative_fund_balance,
        fundedGoalsWithoutTargetSplit: issues.no_target_split,
      },
    };
  }

  /**
   * Declared-gender tally of funded goals per value of one goal_holdings column
   * (fixed column names only), keyed by the value as text ("null" for no value).
   */
  private static async tallyGenderBy(
    column: 'gh.risk_score' | 'gh.goal_category',
    segment: InsightSegment,
    sources: InsightSources
  ): Promise<Map<string, GenderTally>> {
    const segmentFilter = segment === 'ALL' ? Prisma.empty : Prisma.sql`AND gh.segment = ${segment}`;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(column)} AS key, ${Prisma.raw(genderTallySql('v.gender', 'gh.total_value'))}
      FROM ${sources.goalHoldings('gh')}
      LEFT JOIN ${sources.accounts('v')} ON v.account_id = gh.account_id
      WHERE gh.is_funded ${segmentFilter}
      GROUP BY 1`;
    return new Map(rows.map((r) => [String(r.key), readGenderTally(r)]));
  }

  /**
   * Applies each suitability rule and returns per-rule counts and value, plus the
   * flagged goals/accounts (largest first, capped per rule). Goal-level rules use
   * goal_holdings; the age/balance rule is account-level (account_profile_aum).
   */
  static async getSuitabilityReview(limitPerRule: number, sources: InsightSources = LATEST_SOURCES) {
    const r = SUITABILITY_RULES;
    const flagged = await prisma.$queryRaw<any[]>`
      WITH flagged AS (
        SELECT 'OLDER_HIGH_EQUITY' AS rule, gh.account_number, gh.goal_number, ap.age_years, gh.total_value AS value,
               gh.actual_equity_pct, gh.target_equity_pct, gh.risk_score
        FROM ${sources.goalHoldings('gh')} JOIN ${sources.accounts('ap')} ON ap.account_id = gh.account_id
        WHERE gh.is_funded AND gh.segment = 'INDIVIDUAL'
          AND ap.age_years >= ${r.OLDER_HIGH_EQUITY.minAge} AND gh.actual_equity_pct >= ${r.OLDER_HIGH_EQUITY.minEquityPct}
        UNION ALL
        SELECT 'EQUITY_WITHOUT_ASSESSMENT', gh.account_number, gh.goal_number, ap.age_years, gh.total_value,
               gh.actual_equity_pct, gh.target_equity_pct, gh.risk_score
        FROM ${sources.goalHoldings('gh')} JOIN ${sources.accounts('ap')} ON ap.account_id = gh.account_id
        WHERE gh.is_funded AND gh.segment = 'INDIVIDUAL'
          AND COALESCE(gh.risk_score, 0) = 0 AND gh.actual_equity_pct >= ${r.EQUITY_WITHOUT_ASSESSMENT.minEquityPct}
        UNION ALL
        SELECT 'EQUITY_ABOVE_TARGET', gh.account_number, gh.goal_number, ap.age_years, gh.total_value,
               gh.actual_equity_pct, gh.target_equity_pct, gh.risk_score
        FROM ${sources.goalHoldings('gh')} JOIN ${sources.accounts('ap')} ON ap.account_id = gh.account_id
        WHERE gh.is_funded AND gh.segment = 'INDIVIDUAL' AND gh.equity_gap_pp >= ${r.EQUITY_ABOVE_TARGET.minGapPp}
        UNION ALL
        SELECT 'YOUNG_LARGE_BALANCE', ap.account_number, NULL, ap.age_years, ap.aum, NULL, NULL, NULL
        FROM ${sources.accounts('ap')}
        WHERE ap.segment = 'INDIVIDUAL' AND ap.age_years < ${r.YOUNG_LARGE_BALANCE.maxAge}
          AND ap.aum >= ${r.YOUNG_LARGE_BALANCE.minBalance}
      ),
      ranked AS (SELECT f.*, ROW_NUMBER() OVER (PARTITION BY rule ORDER BY value DESC) AS rn,
                        COUNT(*) OVER (PARTITION BY rule) AS rule_count, SUM(value) OVER (PARTITION BY rule) AS rule_value
                 FROM flagged f)
      SELECT rule, account_number, goal_number, age_years, value::float8 AS value, actual_equity_pct::float8 AS actual_equity_pct,
             target_equity_pct::float8 AS target_equity_pct, risk_score, rule_count::int AS rule_count, rule_value::float8 AS rule_value
      FROM ranked WHERE rn <= ${limitPerRule}
      ORDER BY rule, value DESC`;

    const rules = (Object.keys(SUITABILITY_RULES) as SuitabilityRule[]).map((rule) => {
      const rows = flagged.filter((f) => f.rule === rule);
      return {
        rule,
        label: SUITABILITY_RULES[rule].label,
        flagged: rows[0]?.rule_count ?? 0,
        value: rows[0]?.rule_value ?? 0,
        items: rows.map((f) => ({
          accountNumber: f.account_number,
          goalNumber: f.goal_number,
          ageYears: f.age_years,
          value: f.value,
          actualEquityPct: f.actual_equity_pct,
          targetEquityPct: f.target_equity_pct,
          riskScore: f.risk_score,
        })),
      };
    });
    return { scope: 'Individual funded accounts and goals', asOf: sources.asOf, rules };
  }
}
