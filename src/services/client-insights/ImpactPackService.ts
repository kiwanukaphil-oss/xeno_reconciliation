import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  Breakdown,
  ClientInsightsService,
  DEPOSIT_FREQUENCY_SQL,
  MIN_REPORTABLE_GROUP_SIZE,
  WeightedGenderSplit,
} from './ClientInsightsService';
import { AchievementBreakdown, GoalAchievementService } from './GoalAchievementService';
import { InsightSources, LATEST_SOURCES } from './InsightSources';

export type PackQuestion = 'Q1' | 'Q2' | 'Q3';
export type PackColumnFormat = 'text' | 'int' | 'ugx' | 'pct';

export interface PackColumn {
  key: string;
  header: string;
  format: PackColumnFormat;
}

export interface PackTable {
  id: string;
  question: PackQuestion;
  title: string;
  note?: string;
  columns: PackColumn[];
  rows: Array<Record<string, string | number | null>>;
}

export interface ImpactPack {
  generatedAt: string;
  /** snapshot: the as-at date the pack was built for (null = Latest). */
  asOf: { snapshot: string | null; transactions: string; prices: string; ultimaGoalSnapshot: string | null };
  questions: Record<PackQuestion, string>;
  readMe: string[];
  notCaptured: Array<{ item: string; note: string }>;
  tables: PackTable[];
}

// Individual (PERSONAL/JOINT) funded accounts: the base for customer-level statistics
const INDIVIDUAL_FUNDED = Prisma.sql`segment = 'INDIVIDUAL' AND is_funded`;
const PLAUSIBLE_TARGET_MIN = 10000;
const PLAUSIBLE_TARGET_MAX = 10000000000;

const STAT_COLUMNS: PackColumn[] = [
  { key: 'groupType', header: 'Breakdown', format: 'text' },
  { key: 'group', header: 'Group', format: 'text' },
  { key: 'accounts', header: 'Accounts', format: 'int' },
  { key: 'p10', header: '10th pct', format: 'ugx' },
  { key: 'p25', header: '25th pct', format: 'ugx' },
  { key: 'median', header: 'Median', format: 'ugx' },
  { key: 'p75', header: '75th pct', format: 'ugx' },
  { key: 'p90', header: '90th pct', format: 'ugx' },
  { key: 'mean', header: 'Mean', format: 'ugx' },
];

// Standard cuts requested by investors: overall, gender, sign-up channel, location
const STANDARD_GROUPINGS: Array<{ label: string; expression: string }> = [
  { label: 'All individual accounts', expression: `'All'` },
  { label: 'Gender (declared or 90%+ estimate)', expression: 'gender_with_estimate' },
  { label: 'Sign-up channel', expression: 'signup_channel' },
  { label: 'Location', expression: 'location_group' },
];

/**
 * Builds the "Impact & Inclusion" data pack answering the investor questions on
 * customer profile (Q1), usage and accessibility (Q2) and customer outcomes (Q3).
 * Each table carries a note on its base and coverage so partial data is never
 * presented as complete.
 */
export class ImpactPackService {
  static async buildPack(sources: InsightSources = LATEST_SOURCES): Promise<ImpactPack> {
    const [asOf] = await prisma.$queryRaw<any[]>`
      SELECT MIN(data_as_of)::text AS transactions, MIN(price_as_of)::text AS prices,
             (SELECT MAX("asOfDate")::text FROM ultima_goal_snapshots) AS ultima,
             (SELECT MAX("asOfDate")::text FROM ultima_goal_snapshots
              ${sources.asOf === null ? Prisma.empty : Prisma.sql`WHERE "asOfDate" <= ${sources.asOf}::date`}) AS ultima_by_as_of
      FROM ${sources.accounts()}`;
    const summary = await ClientInsightsService.getSummary('INDIVIDUAL', 'ESTIMATED', sources);
    const run = summary.genderEstimate;
    const accuracyNote = run
      ? ` Estimates were ${pct(run.holdoutAccuracy)} accurate on ${fmt(Math.round(run.labelledAccounts * 0.2))} declared accounts held back for testing` +
        (run.mtnHoldoutAccuracy !== null ? ` (${pct(run.mtnHoldoutAccuracy)} for MTN sign-ups).` : '.')
      : '';
    const coverage =
      `Gender declared for ${pct(summary.kpis.genderDeclaredShareOfAccounts)} of individual funded accounts and estimated from the client's name for a further ` +
      `${pct(summary.kpis.genderEstimatedShareOfAccounts)}; ${pct(1 - summary.kpis.genderKnownShareOfAccounts)} remain unknown.` + accuracyNote;

    const tables: PackTable[] = [
      await this.buildAccountBaseTable(sources),
      this.buildWeightedGenderTable(summary.weightedGender, coverage),
      ...(await this.buildProfileTables(coverage, sources)),
      ...(await this.buildUsageTables(coverage, sources)),
      ...(await this.buildOutcomeTables(asOf.ultima_by_as_of, sources)),
    ];

    return {
      generatedAt: new Date().toISOString(),
      asOf: { snapshot: sources.asOf, transactions: asOf.transactions, prices: asOf.prices, ultimaGoalSnapshot: asOf.ultima },
      questions: {
        Q1: 'Customer profile: income levels, livelihoods and location; reach among low-income or underserved savers',
        Q2: 'Usage and accessibility: balances, contributions, saving frequency, USSD vs other channels, by country and gender',
        Q3: 'Customer outcomes: impact indicators, savings goals met, financial resilience',
      },
      readMe: [
        ...(sources.asOf
          ? [
              `All figures are as at ${sources.asOf}: only transactions up to that date are counted, balances use that date's prices and "last 12 months" ends on it. ` +
                'Client profile fields (gender, location, sign-up channel), goal risk scores and goal targets are current Ultima values.',
            ]
          : []),
        `Transactions are complete to ${asOf.transactions}; balances are valued at fund mid prices of ${asOf.prices}.`,
        `Goal targets and progress come from Ultima's goal statistics as of ${asOf.ultima ?? 'n/a'} (a later date than the transaction data).`,
        'Figures count accounts, not people: one person can hold several accounts (e.g. personal and joint).',
        'Funded account = balance of UGX 5,000 or more. Individual = personal and joint accounts; institutional = pooled, linked and sponsor accounts.',
        'Customer-level statistics use individual funded accounts. Institutional accounts are counted separately.',
        coverage + ' Ultima does not capture gender or age for most clients who signed up through MTN. Age splits describe App/Web clients more than USSD clients; "UNKNOWN" is always shown.',
        'Gender estimates: where no gender is declared, it is estimated from the client\'s name using a model learned from the clients who did declare one (e.g. names shared mostly by women). ' +
          'Headline gender shares are probability-weighted: each account counts towards Female and Male in proportion to its estimated probability, which reproduces totals far better than scaling up the known split. ' +
          'Tables that split accounts by gender label an account only where the estimate is at least 90% confident. Estimates are shown to staff in the account directory, always marked as estimates, and are not used for decisions about or communications with individual clients. Accounts marked "rather not say" are never estimated.',
        'Sign-up channel "MTN" means the client registered through the MTN mobile channel (USSD / mobile money); WEB and APP are the web platform and mobile apps.',
        'A deposit or withdrawal is one goal transaction, classified by its net amount across funds; fund switches that net to zero are ignored.',
        `Groups with fewer than ${MIN_REPORTABLE_GROUP_SIZE} accounts are combined or left out so no individual can be identified.`,
      ],
      notCaptured: [
        { item: 'Income level', note: 'Not collected at onboarding. Proxies are shown instead (sign-up channel, location, balance and deposit size).' },
        { item: 'Livelihood / occupation', note: 'Not collected at onboarding.' },
        { item: 'Existing research on low-income reach', note: 'Not held in this system.' },
        { item: 'Investor impact reports', note: 'Not held in this system.' },
        { item: 'Goal target dates', note: 'Ultima holds target amounts only, so "on track" cannot be assessed; only progress to target.' },
      ],
      tables,
    };
  }

  /** How many accounts there are under each common definition of "active". */
  private static async buildAccountBaseTable(sources: InsightSources): Promise<PackTable> {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT segment,
             COUNT(*) FILTER (WHERE deposit_count > 0)::int AS ever_saved,
             COUNT(*) FILTER (WHERE is_funded)::int AS funded,
             COUNT(*) FILTER (WHERE deposits_12m > 0)::int AS saved_12m,
             COALESCE(SUM(aum) FILTER (WHERE is_funded), 0)::float8 AS aum
      FROM ${sources.accounts()} GROUP BY segment ORDER BY segment DESC`;
    const total = rows.reduce(
      (t, r) => ({ ever_saved: t.ever_saved + r.ever_saved, funded: t.funded + r.funded, saved_12m: t.saved_12m + r.saved_12m, aum: t.aum + r.aum }),
      { ever_saved: 0, funded: 0, saved_12m: 0, aum: 0 }
    );
    return {
      id: 'account-base',
      question: 'Q2',
      title: 'Active accounts under different definitions',
      note: '"Approximately 90,000 active accounts" depends on the definition: ever saved, currently funded (UGX 5,000+), or saved in the last 12 months.',
      columns: [
        { key: 'segment', header: 'Segment', format: 'text' },
        { key: 'everSaved', header: 'Ever saved', format: 'int' },
        { key: 'funded', header: 'Funded (UGX 5,000+)', format: 'int' },
        { key: 'saved12m', header: 'Deposited in last 12 months', format: 'int' },
        { key: 'aum', header: 'AUM (UGX)', format: 'ugx' },
      ],
      rows: [...rows, { segment: 'TOTAL', ...total }].map((r) => ({
        segment: r.segment,
        everSaved: r.ever_saved,
        funded: r.funded,
        saved12m: r.saved_12m,
        aum: r.aum,
      })),
    };
  }

  /**
   * Q1 headline: probability-weighted gender split of individual funded accounts and
   * their AUM, with accounts that cannot be estimated shown separately (not allocated).
   */
  private static buildWeightedGenderTable(split: WeightedGenderSplit, coverage: string): PackTable {
    const estimableAccounts = split.femaleAccounts + split.maleAccounts;
    const estimableAum = split.femaleAum + split.maleAum;
    const { basis } = split;
    return {
      id: 'gender-weighted',
      question: 'Q1',
      title: 'Gender (headline estimate, probability-weighted)',
      note:
        `${coverage} Based on ${fmt(basis.declaredAccounts)} declared accounts, ${fmt(basis.estimatedLabelAccounts)} confident estimates and ` +
        `${fmt(basis.probabilityOnlyAccounts)} less certain estimates (weighted by probability). Shares are of accounts with a declared or estimated gender. ` +
        'Estimated account counts are not whole numbers because each account is split by its probability.',
      columns: [
        { key: 'group', header: 'Gender', format: 'text' },
        { key: 'accounts', header: 'Estimated accounts', format: 'int' },
        { key: 'shareOfAccounts', header: 'Share of accounts', format: 'pct' },
        { key: 'aum', header: 'Estimated AUM (UGX)', format: 'ugx' },
        { key: 'shareOfAum', header: 'Share of AUM', format: 'pct' },
      ],
      rows: [
        { group: 'Female', accounts: split.femaleAccounts, shareOfAccounts: ratio(split.femaleAccounts, estimableAccounts), aum: split.femaleAum, shareOfAum: ratio(split.femaleAum, estimableAum) },
        { group: 'Male', accounts: split.maleAccounts, shareOfAccounts: ratio(split.maleAccounts, estimableAccounts), aum: split.maleAum, shareOfAum: ratio(split.maleAum, estimableAum) },
        { group: 'Not estimable (rather not say, or no usable name)', accounts: split.notEstimableAccounts, shareOfAccounts: null, aum: split.notEstimableAum, shareOfAum: null },
      ],
    };
  }

  /** Q1: location, gender, age, and the proxies available in place of income data. */
  private static async buildProfileTables(coverage: string, sources: InsightSources): Promise<PackTable[]> {
    const fetch = (dimension: string) => ClientInsightsService.getBreakdownByName(dimension, 'INDIVIDUAL', 'ESTIMATED', sources);
    const [location, region, district, gender, genderDeclared, age, channel, balanceBands] = await Promise.all([
      fetch('locationGroup'), fetch('region'), fetch('district'), fetch('gender'),
      ClientInsightsService.getBreakdownByName('gender', 'INDIVIDUAL', 'DECLARED', sources),
      fetch('ageBand'), fetch('signupChannel'), fetch('balanceBand'),
    ]);
    const knownNote = (b: Breakdown) => `Known for ${pct(b.knownShareOfAccounts)} of accounts (${pct(b.knownShareOfAum)} of AUM).`;

    return [
      breakdownToTable('location', 'Q1', 'Location: Kampala & Wakiso vs rest of Uganda vs abroad', location, knownNote(location) + ' Location is the district the client typed at sign-up.'),
      breakdownToTable('region', 'Q1', 'Location by region', region, knownNote(region)),
      breakdownToTable('district', 'Q1', 'Location by district (top 15)', district, knownNote(district)),
      breakdownToTable('gender', 'Q1', 'Gender by account: declared, or estimated with 90%+ confidence', gender, coverage),
      breakdownToTable('gender-declared', 'Q1', 'Gender by account: declared in Ultima only (for comparison)', genderDeclared, knownNote(genderDeclared)),
      breakdownToTable('age', 'Q1', 'Age band', age, knownNote(age)),
      breakdownToTable('reach-channel', 'Q1', 'Reach proxy: sign-up channel (MTN = USSD / mobile money, no smartphone needed)', channel, knownNote(channel)),
      breakdownToTable('reach-balance', 'Q1', 'Reach proxy: balance bands', balanceBands, 'Small balances indicate small-scale savers; this is a proxy, not income.'),
    ];
  }

  /** Q2: balances, contributions, saving frequency, channels and country. */
  private static async buildUsageTables(coverage: string, sources: InsightSources): Promise<PackTable[]> {
    const balances = await this.distributionTable(sources, 'balances', 'Balance per account (UGX)', 'aum', INDIVIDUAL_FUNDED, `Individual funded accounts. ${coverage}`);
    const contributions = await this.distributionTable(
      sources,
      'contributions-12m',
      'Amount deposited per account in the last 12 months (UGX)',
      'deposit_amount_12m',
      Prisma.sql`segment = 'INDIVIDUAL' AND deposits_12m > 0`,
      'Individual accounts that made at least one deposit in the last 12 months.'
    );
    const depositSize = await this.distributionTable(
      sources,
      'deposit-size',
      'Typical deposit size: each account\'s median deposit (UGX)',
      'median_deposit',
      Prisma.sql`segment = 'INDIVIDUAL' AND deposit_count > 0`,
      'Individual accounts that have ever deposited; one value per account (its median deposit).'
    );
    const depositsPerYear = await this.distributionTable(
      sources,
      'deposits-per-year',
      'Number of deposits per account in the last 12 months',
      'deposits_12m',
      Prisma.sql`segment = 'INDIVIDUAL' AND deposits_12m > 0`,
      'Individual accounts that deposited in the last 12 months. Values are counts, not UGX.',
      'int'
    );
    const frequency = await this.frequencyCrosstab(sources);
    const transactionSources = await this.transactionSourceTable(sources);
    const [channel, abroad] = await Promise.all([
      ClientInsightsService.getBreakdownByName('signupChannel', 'INDIVIDUAL', 'ESTIMATED', sources),
      ClientInsightsService.getBreakdownByName('abroadCountry', 'INDIVIDUAL', 'ESTIMATED', sources),
    ]);

    return [
      balances,
      contributions,
      depositSize,
      depositsPerYear,
      frequency,
      breakdownToTable('channel-signup', 'Q2', 'USSD vs other channels: sign-up channel', channel, 'Individual funded accounts. Sign-up channel is known for almost all accounts.'),
      transactionSources,
      breakdownToTable('country', 'Q2', 'By country: clients abroad (all others are in Uganda or unknown)', abroad, 'The service is Uganda-based (all funds in UGX). Country of residence is only known where the client typed a foreign location.'),
    ];
  }

  /** Q3: persistence, dormancy, rebuilding after withdrawals, emergency buffers and goal achievement. */
  private static async buildOutcomeTables(ultimaAsOf: string | null, sources: InsightSources): Promise<PackTable[]> {
    const achievement = await GoalAchievementService.getReport('INDIVIDUAL', sources);
    const h = achievement.headline;
    const [k] = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) FILTER (WHERE deposit_count > 0)::int AS ever_saved,
        COUNT(*) FILTER (WHERE deposit_count > 0 AND first_deposit_date <= data_as_of - INTERVAL '12 months')::int AS saved_12m_ago,
        COUNT(*) FILTER (WHERE first_deposit_date <= data_as_of - INTERVAL '12 months' AND deposits_12m > 0)::int AS still_saving,
        COUNT(*) FILTER (WHERE is_funded)::int AS funded,
        COUNT(*) FILTER (WHERE is_funded AND (last_activity_date IS NULL OR last_activity_date <= data_as_of - INTERVAL '12 months'))::int AS dormant,
        COUNT(*) FILTER (WHERE withdrawal_count > 0)::int AS withdrew,
        COUNT(*) FILTER (WHERE withdrawal_count > 0 AND last_deposit_date > last_withdrawal_date)::int AS rebuilt,
        COUNT(*) FILTER (WHERE is_funded AND has_emergency_goal)::int AS emergency_holders
      FROM ${sources.accounts()} WHERE segment = 'INDIVIDUAL'`;
    const [emergency] = await prisma.$queryRaw<any[]>`
      WITH px AS (SELECT DISTINCT ON ("fundId") "fundId", "midPrice" FROM fund_prices
                  WHERE "priceDate" < ${sources.priceCutoff} + 1 ORDER BY "fundId", "priceDate" DESC),
      goal_value AS (
        SELECT ft."goalId", SUM(ft.units * px."midPrice") AS value
        FROM fund_transactions ft
        JOIN goals g ON g.id = ft."goalId" AND g."goalType" = 'EMERGENCY'
        JOIN accounts a ON a.id = g."accountId" AND a."accountType" IN ('PERSONAL', 'JOINT')
        JOIN px ON px."fundId" = ft."fundId"
        WHERE ft."transactionDate" < ${sources.transactionCutoff} + 1
        GROUP BY ft."goalId")
      SELECT COUNT(*) FILTER (WHERE value >= 5000)::int AS funded_goals,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY value) FILTER (WHERE value >= 5000)::float8 AS median_value
      FROM goal_value`;

    const indicator = (label: string, value: number | null, format: PackColumnFormat, base: string) => ({ label, value, format, base });
    const indicators = [
      indicator('Individual accounts that have ever saved', k.ever_saved, 'int', 'Count'),
      indicator('Still saving: deposited in the last 12 months', ratio(k.still_saving, k.saved_12m_ago), 'pct', `of ${fmt(k.saved_12m_ago)} accounts that started saving 12+ months ago`),
      indicator('Dormant: no deposit or withdrawal in 12 months', ratio(k.dormant, k.funded), 'pct', `of ${fmt(k.funded)} funded accounts`),
      indicator('Rebuilt after a withdrawal: deposited again after their last withdrawal', ratio(k.rebuilt, k.withdrew), 'pct', `of ${fmt(k.withdrew)} accounts that have withdrawn`),
      indicator('Hold an emergency goal', ratio(k.emergency_holders, k.funded), 'pct', `of ${fmt(k.funded)} funded accounts`),
      indicator('Median value of a funded emergency goal (UGX)', emergency.median_value, 'ugx', `${fmt(emergency.funded_goals)} emergency goals worth UGX 5,000+`),
      indicator('Goals with a savings target set', h.targetSettingRate, 'pct', `of ${fmt(h.goals)} individual goals`),
      indicator('Reached their savings target (still holding it, or reached it and used the money)', h.everReachedRate, 'pct', `of ${fmt(h.goalsWithPlausibleTarget)} goals with a target`),
      indicator('Reached their target and used the savings (e.g. fees paid)', h.reachedUsedRate, 'pct', `of ${fmt(h.goalsWithPlausibleTarget)} goals with a target`),
    ];

    return [
      {
        id: 'outcome-indicators',
        question: 'Q3',
        title: 'Financial resilience indicators (tracked by the system from now on)',
        note: 'Individual accounts. Balance growth over time will be added once monthly snapshots have built up.',
        columns: [
          { key: 'label', header: 'Indicator', format: 'text' },
          { key: 'value', header: 'Value', format: 'text' },
          { key: 'base', header: 'Base', format: 'text' },
        ],
        rows: indicators.map((i) => ({ label: i.label, value: formatValue(i.value, i.format), base: i.base })),
      },
      await this.persistenceByCohortTable(sources),
      ...this.buildGoalAchievementTables(achievement),
      ...(await this.goalAchievementTables(ultimaAsOf)),
    ];
  }

  /**
   * Q3 goal achievement: status of every individual goal, achievement rates by
   * target size, category, gender, channel and location, saving pace of goals on
   * the way, and how goals with and without a target compare.
   */
  private static buildGoalAchievementTables(report: Awaited<ReturnType<typeof GoalAchievementService.getReport>>): PackTable[] {
    const { asOf, headline } = report;
    const method =
      `Targets and current values from Ultima goal statistics as of ${asOf.ultimaSnapshot}; whether a target was ever reached is worked out from ` +
      `deposits and withdrawals in this system (to ${asOf.transactions}), using cash deposited without investment growth, so it is a conservative count.`;
    const statusLabels: Record<string, string> = {
      REACHED_HOLDING: 'Reached target and still holding it',
      REACHED_USED: 'Reached target, then used the savings',
      IN_PROGRESS: 'On the way to target',
      NOT_STARTED: 'Target set, no savings yet',
      NO_TARGET: 'No target set',
      TARGET_OUT_OF_RANGE: 'Target below UGX 10k or above UGX 10bn (excluded from rates)',
      NO_ULTIMA_DATA: 'Not in the Ultima goal statistics',
    };
    const rateColumns: PackColumn[] = [
      { key: 'goals', header: 'Goals with a target', format: 'int' },
      { key: 'everReachedRate', header: 'Reached target (holding or used)', format: 'pct' },
      { key: 'reachedUsedRate', header: 'Reached and used', format: 'pct' },
      { key: 'medianTarget', header: 'Median target (UGX)', format: 'ugx' },
    ];
    const achievementTable = (id: string, title: string, breakdown: AchievementBreakdown | undefined, note: string): PackTable => ({
      id,
      question: 'Q3',
      title,
      note,
      columns: [{ key: 'group', header: breakdown?.label ?? 'Group', format: 'text' }, ...rateColumns],
      rows: (breakdown?.rows ?? []).map((r) => ({
        group: r.key,
        goals: r.goals,
        everReachedRate: r.everReachedRate,
        reachedUsedRate: r.reachedUsedRate,
        medianTarget: r.medianTarget,
      })),
    });
    const byDimension = (dimension: string) => report.breakdowns.find((b) => b.dimension === dimension);
    const sizeNote = 'Smaller targets are reached far more often, so compare groups with their typical target size in view.';

    return [
      {
        id: 'goal-status',
        question: 'Q3',
        title: 'Savings goals: where every individual goal stands',
        note:
          `${method} ${pct(headline.everReachedRate)} of goals with a target have reached it: ${pct(headline.reachedHoldingRate)} still hold it and ` +
          `${pct(headline.reachedUsedRate)} reached it and then withdrew, e.g. to pay for what they saved for. Counting only goals at target today would miss the second group.`,
        columns: [
          { key: 'status', header: 'Status', format: 'text' },
          { key: 'goals', header: 'Goals', format: 'int' },
          { key: 'share', header: 'Share of goals', format: 'pct' },
          { key: 'value', header: 'Current value (UGX)', format: 'ugx' },
        ],
        rows: report.statuses.map((s) => ({ status: statusLabels[s.key] ?? s.key, goals: s.goals, share: s.share, value: s.value })),
      },
      achievementTable('goal-achievement-target-size', 'Goal targets reached, by target size', byDimension('targetSize'), method),
      achievementTable('goal-achievement-ever-category', 'Goal targets reached (ever), by goal category', byDimension('goalCategory'), `${method} ${sizeNote}`),
      achievementTable(
        'goal-achievement-gender',
        'Goal targets reached, by gender',
        byDimension('gender'),
        `${method} Probability-weighted: declared gender, else estimated from the client's name (see Read me); goal counts are therefore estimates.`
      ),
      achievementTable('goal-achievement-channel', 'Goal targets reached, by sign-up channel', byDimension('signupChannel'), `${method} ${sizeNote}`),
      achievementTable('goal-achievement-location', 'Goal targets reached, by location', byDimension('locationGroup'), `${method} ${sizeNote}`),
      {
        id: 'goal-pace',
        question: 'Q3',
        title: 'Goals on the way: time to target at the current saving pace',
        note: `Goals not yet at target, by how long the remaining amount would take at their net saving rate over the last 12 months of data (to ${asOf.transactions}). Ultima holds no target dates, so this is a pace estimate, not an "on track" measure.`,
        columns: [
          { key: 'pace', header: 'Time to target', format: 'text' },
          { key: 'goals', header: 'Goals', format: 'int' },
          { key: 'share', header: 'Share', format: 'pct' },
        ],
        rows: report.paceBands.map((p) => ({ pace: String(p.key).replace(/^\d+\.\s/, ''), goals: p.goals, share: p.share })),
      },
      {
        id: 'goal-target-setting',
        question: 'Q3',
        title: 'Do savers with a target save more regularly?',
        note: `All individual goals in the Ultima goal statistics. Saving activity is from this system's data (last 12 months to ${asOf.transactions}).`,
        columns: [
          { key: 'group', header: 'Goals', format: 'text' },
          { key: 'goals', header: 'Number', format: 'int' },
          { key: 'savedRate', header: 'Deposited in last 12 months', format: 'pct' },
          { key: 'medianDeposits', header: 'Median deposits (savers, 12m)', format: 'int' },
          { key: 'medianAmount', header: 'Median amount deposited (savers, 12m, UGX)', format: 'ugx' },
          { key: 'medianValue', header: 'Median current value (UGX)', format: 'ugx' },
        ],
        rows: report.targetSetting.map((t) => ({
          group: t.key === 'WITH_TARGET' ? 'With a target' : 'No target',
          goals: t.goals,
          savedRate: t.savedInLast12MonthsRate,
          medianDeposits: t.medianDepositsLast12Months,
          medianAmount: t.medianAmountLast12Months,
          medianValue: t.medianValue,
        })),
      },
    ];
  }

  /**
   * Percentile distribution of one numeric column, overall and per standard
   * grouping. Groups smaller than the minimum size are left out.
   */
  private static async distributionTable(
    sources: InsightSources,
    id: string,
    title: string,
    valueColumn: string,
    filter: Prisma.Sql,
    note: string,
    valueFormat: PackColumnFormat = 'ugx'
  ): Promise<PackTable> {
    const rows: PackTable['rows'] = [];
    for (const grouping of STANDARD_GROUPINGS) {
      const result = await prisma.$queryRaw<any[]>`
        SELECT ${Prisma.raw(grouping.expression)} AS grp, COUNT(*)::int AS n,
          percentile_cont(0.1) WITHIN GROUP (ORDER BY ${Prisma.raw(valueColumn)})::float8 AS p10,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY ${Prisma.raw(valueColumn)})::float8 AS p25,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ${Prisma.raw(valueColumn)})::float8 AS median,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY ${Prisma.raw(valueColumn)})::float8 AS p75,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY ${Prisma.raw(valueColumn)})::float8 AS p90,
          AVG(${Prisma.raw(valueColumn)})::float8 AS mean
        FROM ${sources.accounts()}
        WHERE ${filter} AND ${Prisma.raw(valueColumn)} IS NOT NULL
        GROUP BY 1 ORDER BY (${Prisma.raw(grouping.expression)}) = 'UNKNOWN', n DESC`;
      for (const r of result.filter((x) => x.n >= MIN_REPORTABLE_GROUP_SIZE)) {
        rows.push({ groupType: grouping.label, group: r.grp, accounts: r.n, p10: r.p10, p25: r.p25, median: r.median, p75: r.p75, p90: r.p90, mean: r.mean });
      }
    }
    const columns = STAT_COLUMNS.map((c) => (c.format === 'ugx' ? { ...c, format: valueFormat } : c));
    return { id, question: 'Q2', title, note, columns, rows };
  }

  /**
   * Share of accounts by number of months with a deposit, overall and by gender and
   * channel. Gender columns are probability-weighted (each account adds its female
   * probability to Female and the rest to Male), like the headline gender table.
   */
  private static async frequencyCrosstab(sources: InsightSources): Promise<PackTable> {
    const columns = [
      { key: 'all', header: 'All', weight: '1' },
      { key: 'female', header: 'Female (estimated)', weight: 'COALESCE(female_probability, 0)' },
      { key: 'male', header: 'Male (estimated)', weight: 'COALESCE(1 - female_probability, 0)' },
      { key: 'genderUnknown', header: 'Gender not estimable', weight: 'CASE WHEN female_probability IS NULL THEN 1 ELSE 0 END' },
      { key: 'mtn', header: 'MTN sign-up', weight: `CASE WHEN signup_channel = 'MTN' THEN 1 ELSE 0 END` },
      { key: 'app', header: 'App sign-up', weight: `CASE WHEN signup_channel = 'APP' THEN 1 ELSE 0 END` },
      { key: 'web', header: 'Web sign-up', weight: `CASE WHEN signup_channel = 'WEB' THEN 1 ELSE 0 END` },
    ];
    const counts = columns.map((c) => Prisma.raw(`SUM(${c.weight})::float8 AS "${c.key}"`));
    const result = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(DEPOSIT_FREQUENCY_SQL)} AS band, ${Prisma.join(counts)}
      FROM ${sources.accounts()} WHERE ${INDIVIDUAL_FUNDED} GROUP BY 1 ORDER BY 1`;
    const totals = Object.fromEntries(columns.map((c) => [c.key, result.reduce((s, r) => s + r[c.key], 0)]));
    return {
      id: 'saving-frequency',
      question: 'Q2',
      title: 'Saving frequency: months with at least one deposit in the last 12 months',
      note: 'Share of individual funded accounts in each column. Gender columns are probability-weighted estimates (see Read me).',
      columns: [{ key: 'band', header: 'Months with a deposit', format: 'text' }, ...columns.map((c) => ({ key: c.key, header: c.header, format: 'pct' as const }))],
      rows: result.map((r) => ({
        band: r.band,
        ...Object.fromEntries(columns.map((c) => [c.key, ratio(r[c.key], totals[c.key])])),
      })),
    };
  }

  /** Channel each deposit came through in the last 12 months (where the source is recorded). */
  private static async transactionSourceTable(sources: InsightSources): Promise<PackTable> {
    const result = await prisma.$queryRaw<any[]>`
      WITH cutoff AS (SELECT ${sources.transactionCutoff}::timestamp AS d),
      deposits AS (
        SELECT "goalTransactionCode", MIN(source::text) AS source, SUM(amount) AS net
        FROM fund_transactions, cutoff
        WHERE "transactionDate" > cutoff.d - INTERVAL '12 months' AND "transactionDate" < cutoff.d + INTERVAL '1 day'
        GROUP BY "goalTransactionCode" HAVING SUM(amount) >= 1)
      SELECT COALESCE(source, 'Not recorded') AS source, COUNT(*)::int AS deposits, SUM(net)::float8 AS amount
      FROM deposits GROUP BY 1 ORDER BY 2 DESC`;
    const totalDeposits = result.reduce((s, r) => s + r.deposits, 0);
    const totalAmount = result.reduce((s, r) => s + r.amount, 0);
    const unrecorded = result.find((r) => r.source === 'Not recorded')?.deposits ?? 0;
    return {
      id: 'channel-deposits',
      question: 'Q2',
      title: 'Channel used for deposits in the last 12 months',
      note: `All accounts. The channel is not recorded for ${pct(ratio(unrecorded, totalDeposits))} of deposits, so read shares among recorded deposits with care.`,
      columns: [
        { key: 'source', header: 'Channel', format: 'text' },
        { key: 'deposits', header: 'Deposits', format: 'int' },
        { key: 'shareOfDeposits', header: 'Share of deposits', format: 'pct' },
        { key: 'amount', header: 'Amount (UGX)', format: 'ugx' },
        { key: 'shareOfAmount', header: 'Share of amount', format: 'pct' },
      ],
      rows: result.map((r) => ({
        source: r.source,
        deposits: r.deposits,
        shareOfDeposits: ratio(r.deposits, totalDeposits),
        amount: r.amount,
        shareOfAmount: ratio(r.amount, totalAmount),
      })),
    };
  }

  /** For each year accounts started saving: how many are still saving and still funded. */
  private static async persistenceByCohortTable(sources: InsightSources): Promise<PackTable> {
    const result = await prisma.$queryRaw<any[]>`
      SELECT EXTRACT(YEAR FROM first_deposit_date)::int AS cohort, COUNT(*)::int AS accounts,
             COUNT(*) FILTER (WHERE deposits_12m > 0)::int AS saving,
             COUNT(*) FILTER (WHERE is_funded)::int AS funded,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY aum) FILTER (WHERE is_funded)::float8 AS median_balance
      FROM ${sources.accounts()}
      WHERE segment = 'INDIVIDUAL' AND first_deposit_date IS NOT NULL
      GROUP BY 1 ORDER BY 1`;
    return {
      id: 'persistence-cohorts',
      question: 'Q3',
      title: 'Persistence by year of first deposit',
      note: 'Individual accounts. The latest year is partly within the 12-month window, so its "still saving" share is naturally high.',
      columns: [
        { key: 'cohort', header: 'First deposit year', format: 'text' },
        { key: 'accounts', header: 'Accounts', format: 'int' },
        { key: 'stillSaving', header: 'Deposited in last 12 months', format: 'pct' },
        { key: 'stillFunded', header: 'Still funded (UGX 5,000+)', format: 'pct' },
        { key: 'medianBalance', header: 'Median balance of funded (UGX)', format: 'ugx' },
      ],
      rows: result
        .filter((r) => r.accounts >= MIN_REPORTABLE_GROUP_SIZE)
        .map((r) => ({
          cohort: String(r.cohort),
          accounts: r.accounts,
          stillSaving: ratio(r.saving, r.accounts),
          stillFunded: ratio(r.funded, r.accounts),
          medianBalance: r.median_balance,
        })),
    };
  }

  /**
   * CANDIDATE FOR REMOVAL: superseded by buildGoalAchievementTables (goal-status and the
   * achievement tables count goals that reached their target and then used the money; these
   * count only goals at target today). Kept for now so existing readers of the pack still find them.
   *
   * Progress towards goal targets from the latest Ultima goal snapshot, for
   * individual accounts' goals with a plausible target (UGX 10k to 10bn).
   */
  private static async goalAchievementTables(ultimaAsOf: string | null): Promise<PackTable[]> {
    if (!ultimaAsOf) return [];
    const base = Prisma.sql`
      FROM ultima_goal_snapshots s
      JOIN goals g ON g.id = s."goalId"
      JOIN accounts a ON a.id = g."accountId" AND a."accountType" IN ('PERSONAL', 'JOINT')
      WHERE s."asOfDate" = ${ultimaAsOf}::date
        AND s."goalTarget" >= ${PLAUSIBLE_TARGET_MIN} AND s."goalTarget" < ${PLAUSIBLE_TARGET_MAX}`;
    // Date passed as text: a JS Date is bound as a timestamp and the server timezone shifts it
    const [totals] = await prisma.$queryRaw<any[]>`SELECT COUNT(*)::int AS goals ${base}`;
    const bands = await prisma.$queryRaw<any[]>`
      SELECT CASE
          WHEN s."currentValue" >= s."goalTarget" THEN '6. Reached (100%+)'
          WHEN s."currentValue" >= 0.75 * s."goalTarget" THEN '5. 75-99%'
          WHEN s."currentValue" >= 0.5 * s."goalTarget" THEN '4. 50-74%'
          WHEN s."currentValue" >= 0.25 * s."goalTarget" THEN '3. 25-49%'
          WHEN s."currentValue" >= 0.1 * s."goalTarget" THEN '2. 10-24%'
          ELSE '1. Under 10%' END AS band,
        COUNT(*)::int AS goals
      ${base} GROUP BY 1 ORDER BY 1`;
    const categories = await prisma.$queryRaw<any[]>`
      SELECT COALESCE(g."ultimaGoalName", 'Unknown') AS category, COUNT(*)::int AS goals,
             COUNT(*) FILTER (WHERE s."currentValue" >= s."goalTarget")::int AS reached,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s."goalTarget")::float8 AS median_target,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s."currentValue" / s."goalTarget")::float8 AS median_progress
      ${base} GROUP BY 1 ORDER BY 2 DESC`;

    const note = `Ultima goal statistics as of ${ultimaAsOf}. ${fmt(totals.goals)} individual goals have a target between UGX 10k and 10bn (targets are optional and set by the client; there are no target dates).`;
    return [
      {
        id: 'goal-progress',
        question: 'Q3',
        title: 'Progress towards savings goal targets',
        note,
        columns: [
          { key: 'band', header: 'Progress to target', format: 'text' },
          { key: 'goals', header: 'Goals', format: 'int' },
          { key: 'share', header: 'Share', format: 'pct' },
        ],
        rows: bands.map((b) => ({ band: b.band, goals: b.goals, share: ratio(b.goals, totals.goals) })),
      },
      {
        id: 'goal-progress-category',
        question: 'Q3',
        title: 'Goal targets reached, by goal category',
        note,
        columns: [
          { key: 'category', header: 'Goal category', format: 'text' },
          { key: 'goals', header: 'Goals with target', format: 'int' },
          { key: 'reachedShare', header: 'Reached target', format: 'pct' },
          { key: 'medianTarget', header: 'Median target (UGX)', format: 'ugx' },
          { key: 'medianProgress', header: 'Median progress', format: 'pct' },
        ],
        rows: categories
          .filter((c) => c.goals >= MIN_REPORTABLE_GROUP_SIZE)
          .map((c) => ({
            category: c.category,
            goals: c.goals,
            reachedShare: ratio(c.reached, c.goals),
            medianTarget: c.median_target,
            medianProgress: c.median_progress,
          })),
      },
    ];
  }
}

/** Turns a ClientInsightsService breakdown into a pack table. */
function breakdownToTable(id: string, question: PackQuestion, title: string, breakdown: Breakdown, note: string): PackTable {
  return {
    id,
    question,
    title,
    note,
    columns: [
      { key: 'group', header: breakdown.label, format: 'text' },
      { key: 'accounts', header: 'Accounts', format: 'int' },
      { key: 'shareOfAccounts', header: 'Share of accounts', format: 'pct' },
      { key: 'aum', header: 'AUM (UGX)', format: 'ugx' },
      { key: 'shareOfAum', header: 'Share of AUM', format: 'pct' },
      { key: 'medianBalance', header: 'Median balance (UGX)', format: 'ugx' },
    ],
    rows: breakdown.rows.map((r) => ({
      group: r.key,
      accounts: r.accounts,
      shareOfAccounts: r.shareOfAccounts,
      aum: r.aum,
      shareOfAum: r.shareOfAum,
      medianBalance: r.medianBalance,
    })),
  };
}

function ratio(part: number, whole: number): number | null {
  return whole ? part / whole : null;
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function fmt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatValue(value: number | null, format: PackColumnFormat): string {
  if (value === null) return 'n/a';
  if (format === 'pct') return pct(value);
  if (format === 'ugx') return `UGX ${fmt(value)}`;
  return fmt(value);
}
