import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { BadRequestError } from '../../errors';
import { InsightSnapshotService, SnapshotDateInfo } from '../client-insights/InsightSnapshotService';
import { SignupChannel } from '../client-profile/SignupCountCollector';

/**
 * Monthly "Inputs-UG" figures of the XENO_Metrics report, computed from the system.
 *
 * Definitions (agreed with the business, 2026-11-03):
 * - Business line: account number 711 = Corporate Treasury, 72x (720/721/722) = Retirement Schemes (URBRA schemes),
 *   73/74/75 = Groups; otherwise Ultima sign-up Source "MTN" = B2B2C Telco; everything else = B2C.
 * - Funded / active = balance of UGX 5,000 or more at month-end (users = accounts, not deduplicated people).
 * - New funded / new active = unfunded at the previous month-end and funded at this one; closed / churned
 *   is the reverse (fell below UGX 5,000 during the month).
 * - Business-line account counts: Groups count only the group (POOLED) account; Corporate Treasury and
 *   Retirement Schemes leave out members' LINKED accounts. AUM and flows include every account in the line.
 * - Flows are goal transactions dated in the month, excluding Transfer_Reversal. Bank deposits are counted
 *   per goal transaction (the system's criterion), not per bank transfer.
 * - "New funded" by channel = all of the month's deposits by accounts whose first deposit was this month;
 *   "funded again" = every other deposit.
 * - Retention since inception = funded accounts / accounts that ever deposited.
 */

export const BUSINESS_LINES = [
  'B2C_INDIVIDUALS',
  'B2B_GROUPS',
  'B2B_CORPORATE_TREASURY',
  'B2B_RETIREMENT_SCHEMES',
  'B2B2C_TELCO',
  'B2B2C_OTHERS',
] as const;
export type BusinessLine = (typeof BUSINESS_LINES)[number];

export const CUSTOMER_GROUPS = ['INDIVIDUALS', 'GROUPS', 'INSTITUTIONS'] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];

const CUSTOMER_GROUP_OF_LINE: Record<BusinessLine, CustomerGroup> = {
  B2C_INDIVIDUALS: 'INDIVIDUALS',
  B2B2C_TELCO: 'INDIVIDUALS',
  B2B2C_OTHERS: 'INDIVIDUALS',
  B2B_GROUPS: 'GROUPS',
  B2B_CORPORATE_TREASURY: 'INSTITUTIONS',
  B2B_RETIREMENT_SCHEMES: 'INSTITUTIONS',
};

export const INFLOW_CHANNELS = ['BANK', 'MTN_WEB', 'MTN_USSD', 'MTN_APP', 'AIRTEL_WEB', 'AIRTEL_USSD', 'AIRTEL_APP', 'OTHER'] as const;
export type InflowChannel = (typeof INFLOW_CHANNELS)[number];
export const OUTFLOW_CHANNELS = ['BANK', 'MTN', 'AIRTEL', 'OTHER'] as const;
export type OutflowChannel = (typeof OUTFLOW_CHANNELS)[number];

export const WEALTH_BANDS = [
  { band: 'M0', label: 'Below UGX 2m', upTo: 2e6 },
  { band: 'M1', label: 'UGX 2m to 10m', upTo: 10e6 },
  { band: 'M2', label: 'UGX 10m to 25m', upTo: 25e6 },
  { band: 'M3', label: 'UGX 25m to 50m', upTo: 50e6 },
  { band: 'M4', label: 'UGX 50m to 100m', upTo: 100e6 },
  { band: 'M5', label: 'UGX 100m to 250m', upTo: 250e6 },
  { band: 'M6', label: 'UGX 250m to 500m', upTo: 500e6 },
  { band: 'M7', label: 'UGX 500m to 1b', upTo: 1e9 },
  { band: 'M8', label: 'Above UGX 1b', upTo: null },
] as const;

type ByKey<K extends string> = Record<K, number>;

interface FlowTotals {
  value: number;
  volume: number;
}

export interface BusinessLineMetrics {
  activeAccounts: number | null;
  newActiveAccounts: number | null;
  churnedAccounts: number | null;
  aum: number | null;
  depositValue: number | null;
  /** Negative, as in the report. */
  withdrawalValue: number | null;
  depositVolume: number | null;
  withdrawalVolume: number | null;
}

export interface CustomerGroupMetrics {
  aum: number;
  fundedAccounts: number;
  inflowValue: number;
  inflowVolume: number;
  /** Negative, as in the report. */
  outflowValue: number;
  outflowVolume: number;
}

export interface UgMonthlyMetrics {
  month: string;
  periodStart: string;
  periodEnd: string;
  previousPeriodEnd: string;
  priceAsOf: string | null;
  headline: {
    registered: number | null;
    activeAccounts: number;
    aum: number;
    retentionSinceInception: number | null;
    newRegistered: number | null;
    newFundedAccounts: number;
    closedAccounts: number;
    fundedAccounts: number;
  };
  newFunded: { value: ByKey<InflowChannel>; volume: ByKey<InflowChannel> };
  fundedAgain: FlowTotals;
  inflows: { value: ByKey<InflowChannel>; volume: ByKey<InflowChannel> };
  /** Values are negative, as in the report. */
  outflows: { value: ByKey<OutflowChannel>; volume: ByKey<OutflowChannel> };
  customerGroups: Record<CustomerGroup, CustomerGroupMetrics>;
  wealthBands: Array<{ band: string; label: string; activeUsers: number; aum: number }>;
  businessLines: Record<BusinessLine, BusinessLineMetrics>;
  /** Accounts created in the month by sign-up channel (null when the month's Client Data export is not imported). */
  newRegisteredByChannel: Record<SignupChannel, number> | null;
  active: { users: number; accounts: number; goals: number };
  notComputed: Array<{ metric: string; reason: string }>;
}

export type UgMonthlyMetricsResult =
  | { ready: true; metrics: UgMonthlyMetrics }
  | { ready: false; snapshots: SnapshotDateInfo[] };

export type UgMonthlyMetricsRangeResult =
  | { ready: true; months: UgMonthlyMetrics[] }
  | { ready: false; snapshots: SnapshotDateInfo[] };

// One request covers at most two years of month columns
const MAX_MONTHS = 24;
const monthCache = new Map<string, { cacheKey: string; metrics: UgMonthlyMetrics }>();

// How the figures are defined; shown on the page and in the Excel "About" sheet
export const UG_METRIC_DEFINITIONS: string[] = [
  'Business lines by account number: 711 = Corporate Treasury; 72x (720/721/722) = Retirement Schemes (URBRA schemes); 73/74/75 = Groups. Other accounts: Ultima sign-up Source "MTN" = B2B2C Telco; the rest = B2C Individuals.',
  'Customer groups: Individuals = B2C + Telco; Groups = B2B Groups; Institutions = Corporate Treasury + Retirement Schemes. Counts include members\' linked accounts.',
  'Business-line account counts: Groups count only the group (pooled) account; Corporate Treasury and Retirement Schemes leave out members\' linked accounts. AUM and flows include every account.',
  'Active / funded = balance of UGX 5,000 or more at month-end, valued at month-end mid prices. Users = accounts (people are not deduplicated).',
  'New funded / new active = unfunded at the previous month-end and funded at this one; closed / churned = the reverse (fell below UGX 5,000 during the month).',
  'Flows are goal transactions dated in the month, excluding Transfer_Reversal. Volumes count goal transactions, so one bank transfer split across goals counts once per goal.',
  'New Funded by channel = all of the month\'s deposits by accounts whose first deposit was this month; Funded Again = every other deposit.',
  'Customer Retention (Since Inception) = funded accounts / accounts that have ever deposited.',
  'New Registered = Ultima accounts created in the month, by sign-up Source (MTN = MTN USSD, WEB_* = Web, APP_ANDROID_* = Android, APP_IOS_* = iOS). Registered = running total of distinct users (phone numbers) by the month they joined. Counted from the Ultima Client Data exports; only the counts are stored. Blank if the month\'s export has not been imported.',
  'Outflow values are negative, as in the report.',
];

// Metrics the system has no inputs for; listed in every response so the report shows them as manual
const NOT_COMPUTED: Array<{ metric: string; reason: string }> = [
  { metric: 'USD/UGX', reason: 'Bank of Uganda rate: manual input' },
  { metric: 'Spend, Revenue, Liquid Assets, XENO Uganda AUM and gains', reason: 'Accounting system / general ledger' },
  { metric: 'Sales and marketing costs and payroll, Total CAC', reason: 'Accounting and payroll' },
  { metric: 'Bank accounts (Stanbic UGX / USD)', reason: 'Bank statements' },
  { metric: 'Visitors by channel', reason: 'Web/app analytics and MTN/Airtel USSD session logs' },
  { metric: 'Autosaves (users, accounts, goals, channel)', reason: 'Ultima standing-order data is not loaded' },
  { metric: 'B2B2C: Partnerships - Others', reason: 'No partner field in the data' },
];

// Business line of an account in the month-end snapshot "e" with its profile "pr"
const BUSINESS_LINE_SQL = Prisma.sql`
  CASE
    WHEN e.account_number LIKE '711%' THEN 'B2B_CORPORATE_TREASURY'
    WHEN e.account_number LIKE '72%' THEN 'B2B_RETIREMENT_SCHEMES'
    WHEN e.account_number ~ '^7[345]' THEN 'B2B_GROUPS'
    WHEN pr."signupSourceRaw" = 'MTN' THEN 'B2B2C_TELCO'
    ELSE 'B2C_INDIVIDUALS'
  END`;

// Whether the account counts towards its business line's account numbers (group-level accounts only for B2B)
const COUNTED_IN_LINE_SQL = Prisma.sql`
  CASE
    WHEN e.account_number ~ '^7[345]' THEN e.account_type = 'POOLED'
    WHEN e.account_number ~ '^(711|72)' THEN e.account_type <> 'LINKED'
    ELSE true
  END`;

const INFLOW_CHANNEL_SQL = Prisma.sql`
  CASE WHEN ev.source IN ('BANK','MTN_WEB','MTN_USSD','MTN_APP','AIRTEL_WEB','AIRTEL_USSD','AIRTEL_APP')
       THEN ev.source ELSE 'OTHER' END`;

const OUTFLOW_CHANNEL_SQL = Prisma.sql`
  CASE WHEN ev.source = 'BANK' THEN 'BANK'
       WHEN ev.source LIKE 'MTN%' THEN 'MTN'
       WHEN ev.source LIKE 'AIRTEL%' THEN 'AIRTEL'
       ELSE 'OTHER' END`;

const zeroed = <K extends string>(keys: readonly K[]): ByKey<K> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as ByKey<K>;

export class UgMonthlyMetricsService {
  /**
   * Inputs-UG figures for one month (YYYY-MM). Needs the stored snapshots for the month-end and the
   * previous month-end; if either is not ready a build is started and the snapshot statuses are returned
   * instead, so the caller can show "preparing" and try again.
   */
  static async getMonth(month: string): Promise<UgMonthlyMetricsResult> {
    const result = await this.getMonths(month, month);
    return result.ready ? { ready: true, metrics: result.months[0] } : result;
  }

  /**
   * Inputs-UG figures for every month from `from` to `to` (YYYY-MM, at most MAX_MONTHS). All the
   * month-end snapshots involved must be ready; any that are not are built together and their statuses
   * returned. Computed months are cached against the build times of their two snapshots, so a rebuilt
   * (stale) month is recomputed and an unchanged one is served instantly.
   */
  static async getMonths(from: string, to: string): Promise<UgMonthlyMetricsRangeResult> {
    const months = monthsBetween(from, to);
    if (months.length > MAX_MONTHS) throw new BadRequestError(`Choose at most ${MAX_MONTHS} months`);
    const periods = months.map(monthPeriod);
    await InsightSnapshotService.assertReportableDate(periods[periods.length - 1].end);

    // The month before the first transaction has no snapshot to build; it simply has no accounts
    const { firstTransaction } = await InsightSnapshotService.getDataRange();
    const neededDates = [...new Set(periods.flatMap((p) => [p.end, p.previousEnd]))].filter((d) => d >= firstTransaction);
    const snapshots = new Map<string, SnapshotDateInfo>();
    for (const date of neededDates) snapshots.set(date, await InsightSnapshotService.getSnapshot(date));

    const notReady = [...snapshots.values()].filter((s) => s.status !== 'READY');
    if (notReady.length > 0) {
      const building = await Promise.all(notReady.map((s) => InsightSnapshotService.requestBuild(s.asOf, true)));
      return { ready: false, snapshots: building };
    }

    // A new sign-up count import changes Registered figures without rebuilding any snapshot
    const [signupImport] = await prisma.$queryRaw<Array<{ at: Date | null }>>`
      SELECT MAX("importedAt") AS at FROM ultima_signup_monthly_counts`;
    const results: UgMonthlyMetrics[] = [];
    for (const [i, period] of periods.entries()) {
      const end = snapshots.get(period.end)!;
      const cacheKey = `${end.builtAt}|${snapshots.get(period.previousEnd)?.builtAt ?? 'none'}|${signupImport?.at?.toISOString() ?? 'none'}`;
      const cached = monthCache.get(months[i]);
      if (cached?.cacheKey === cacheKey) {
        results.push(cached.metrics);
        continue;
      }
      const metrics = await this.computeMonth(months[i], period, end.priceAsOf);
      monthCache.set(months[i], { cacheKey, metrics });
      results.push(metrics);
    }
    return { ready: true, months: results };
  }

  /**
   * Runs the two queries (month-end account positions, and the month's flows) and assembles every
   * Inputs-UG input from them. Customer groups are roll-ups of business lines.
   */
  private static async computeMonth(month: string, period: MonthPeriod, priceAsOf: string | null): Promise<UgMonthlyMetrics> {
    const [positions, bands, flows, fundedGoals, signups] = await Promise.all([
      this.queryPositionsByLine(period),
      this.queryWealthBands(period),
      this.queryFlows(period),
      this.queryFundedGoals(period),
      this.querySignups(period),
    ]);

    const businessLines = Object.fromEntries(
      BUSINESS_LINES.map((line) => [line, emptyLineMetrics(line)])
    ) as Record<BusinessLine, BusinessLineMetrics>;
    const customerGroups = Object.fromEntries(
      CUSTOMER_GROUPS.map((g) => [g, { aum: 0, fundedAccounts: 0, inflowValue: 0, inflowVolume: 0, outflowValue: 0, outflowVolume: 0 }])
    ) as Record<CustomerGroup, CustomerGroupMetrics>;

    let fundedAccounts = 0, aum = 0, everDeposited = 0, newFundedAccounts = 0, closedAccounts = 0;
    for (const p of positions) {
      const line = businessLines[p.line];
      line.activeAccounts = p.funded_counted;
      line.newActiveAccounts = p.new_active_counted;
      line.churnedAccounts = p.churned_counted;
      line.aum = p.aum;
      const group = customerGroups[CUSTOMER_GROUP_OF_LINE[p.line]];
      group.aum += p.aum;
      group.fundedAccounts += p.funded_all;
      fundedAccounts += p.funded_all;
      aum += p.aum;
      everDeposited += p.ever_deposited;
      newFundedAccounts += p.new_active_all;
      closedAccounts += p.churned_all;
    }

    const newFunded = { value: zeroed(INFLOW_CHANNELS), volume: zeroed(INFLOW_CHANNELS) };
    const inflows = { value: zeroed(INFLOW_CHANNELS), volume: zeroed(INFLOW_CHANNELS) };
    const outflows = { value: zeroed(OUTFLOW_CHANNELS), volume: zeroed(OUTFLOW_CHANNELS) };
    const fundedAgain: FlowTotals = { value: 0, volume: 0 };
    for (const f of flows) {
      const line = businessLines[f.line];
      const group = customerGroups[CUSTOMER_GROUP_OF_LINE[f.line]];
      if (f.is_deposit) {
        const channel = f.inflow_channel;
        inflows.value[channel] += f.amount;
        inflows.volume[channel] += f.events;
        if (f.is_new_account) {
          newFunded.value[channel] += f.amount;
          newFunded.volume[channel] += f.events;
        } else {
          fundedAgain.value += f.amount;
          fundedAgain.volume += f.events;
        }
        line.depositValue = (line.depositValue ?? 0) + f.amount;
        line.depositVolume = (line.depositVolume ?? 0) + f.events;
        group.inflowValue += f.amount;
        group.inflowVolume += f.events;
      } else {
        outflows.value[f.outflow_channel] += f.amount;
        outflows.volume[f.outflow_channel] += f.events;
        line.withdrawalValue = (line.withdrawalValue ?? 0) + f.amount;
        line.withdrawalVolume = (line.withdrawalVolume ?? 0) + f.events;
        group.outflowValue += f.amount;
        group.outflowVolume += f.events;
      }
    }

    return {
      month,
      periodStart: period.start,
      periodEnd: period.end,
      previousPeriodEnd: period.previousEnd,
      priceAsOf,
      headline: {
        registered: signups.registered,
        activeAccounts: fundedAccounts,
        aum,
        retentionSinceInception: everDeposited > 0 ? fundedAccounts / everDeposited : null,
        newRegistered: signups.byChannel ? Object.values(signups.byChannel).reduce((s, n) => s + n, 0) : null,
        newFundedAccounts,
        closedAccounts,
        fundedAccounts,
      },
      newFunded,
      fundedAgain,
      inflows,
      outflows,
      customerGroups,
      wealthBands: WEALTH_BANDS.map((b) => {
        const row = bands.find((r) => r.band === b.band);
        return { band: b.band, label: b.label, activeUsers: row?.accounts ?? 0, aum: row?.aum ?? 0 };
      }),
      businessLines,
      newRegisteredByChannel: signups.byChannel,
      active: { users: fundedAccounts, accounts: fundedAccounts, goals: fundedGoals },
      notComputed: NOT_COMPUTED,
    };
  }

  /** Month-end positions per business line: funded, new, churned (counted and all accounts), AUM. */
  private static async queryPositionsByLine(period: MonthPeriod) {
    const rows = await prisma.$queryRaw<any[]>`
      WITH acct AS (
        SELECT ${BUSINESS_LINE_SQL} AS line,
               ${COUNTED_IN_LINE_SQL} AS counted,
               e.is_funded AS funded_now,
               COALESCE(p.is_funded, false) AS funded_before,
               e.first_deposit_date IS NOT NULL AS ever_deposited,
               e.aum
        FROM insights.account_snapshots e
        LEFT JOIN insights.account_snapshots p
          ON p.as_of_date = ${period.previousEnd}::date AND p.account_number = e.account_number
        LEFT JOIN account_profiles pr ON pr."accountId" = e.account_id
        WHERE e.as_of_date = ${period.end}::date
      )
      SELECT line,
             COUNT(*) FILTER (WHERE funded_now)::int AS funded_all,
             COUNT(*) FILTER (WHERE funded_now AND counted)::int AS funded_counted,
             COUNT(*) FILTER (WHERE funded_now AND NOT funded_before)::int AS new_active_all,
             COUNT(*) FILTER (WHERE funded_now AND NOT funded_before AND counted)::int AS new_active_counted,
             COUNT(*) FILTER (WHERE funded_before AND NOT funded_now)::int AS churned_all,
             COUNT(*) FILTER (WHERE funded_before AND NOT funded_now AND counted)::int AS churned_counted,
             COUNT(*) FILTER (WHERE ever_deposited)::int AS ever_deposited,
             COALESCE(SUM(aum) FILTER (WHERE funded_now), 0)::float8 AS aum
      FROM acct GROUP BY line`;
    return rows as Array<{
      line: BusinessLine;
      funded_all: number;
      funded_counted: number;
      new_active_all: number;
      new_active_counted: number;
      churned_all: number;
      churned_counted: number;
      ever_deposited: number;
      aum: number;
    }>;
  }

  /** Funded accounts and their AUM per wealth band (M0-M8) at month-end. */
  private static async queryWealthBands(period: MonthPeriod) {
    const bandCase = Prisma.join(
      WEALTH_BANDS.filter((b) => b.upTo !== null).map((b) => Prisma.sql`WHEN aum < ${b.upTo} THEN ${b.band}`),
      ' '
    );
    return prisma.$queryRaw<Array<{ band: string; accounts: number; aum: number }>>`
      SELECT CASE ${bandCase} ELSE 'M8' END AS band, COUNT(*)::int AS accounts, SUM(aum)::float8 AS aum
      FROM insights.account_snapshots
      WHERE as_of_date = ${period.end}::date AND is_funded
      GROUP BY 1`;
  }

  /**
   * The month's goal transactions (reversals excluded), netted per goal transaction code like the
   * snapshots do, grouped by business line, direction, channel and whether the account is new this month.
   */
  private static async queryFlows(period: MonthPeriod) {
    const rows = await prisma.$queryRaw<any[]>`
      WITH ev AS (
        SELECT ft."accountId", MIN(ft.source::text) AS source, SUM(ft.amount) AS net
        FROM fund_transactions ft
        WHERE ft."transactionDate" >= ${period.start}::date AND ft."transactionDate" < ${period.end}::date + 1
          AND ft.source IS DISTINCT FROM 'Transfer_Reversal'
        GROUP BY ft."accountId", ft."goalTransactionCode"
        HAVING ABS(SUM(ft.amount)) >= 1
      )
      SELECT ${BUSINESS_LINE_SQL} AS line,
             ev.net > 0 AS is_deposit,
             ${INFLOW_CHANNEL_SQL} AS inflow_channel,
             ${OUTFLOW_CHANNEL_SQL} AS outflow_channel,
             (e.first_deposit_date >= ${period.start}::date AND p.first_deposit_date IS NULL) AS is_new_account,
             COUNT(*)::int AS events,
             SUM(ev.net)::float8 AS amount
      FROM ev
      JOIN insights.account_snapshots e ON e.as_of_date = ${period.end}::date AND e.account_id = ev."accountId"
      LEFT JOIN insights.account_snapshots p
        ON p.as_of_date = ${period.previousEnd}::date AND p.account_number = e.account_number
      LEFT JOIN account_profiles pr ON pr."accountId" = e.account_id
      GROUP BY 1, 2, 3, 4, 5`;
    return rows.map((r) => ({ ...r, is_new_account: r.is_new_account === true })) as Array<{
      line: BusinessLine;
      is_deposit: boolean;
      inflow_channel: InflowChannel;
      outflow_channel: OutflowChannel;
      is_new_account: boolean;
      events: number;
      amount: number;
    }>;
  }

  /**
   * Sign-ups from the stored monthly counts (Ultima Client Data exports): accounts created in the month
   * by channel, and Registered = running total of users who joined up to month-end. Both are null when
   * the month has no stored counts, so a missing import shows blank rather than a wrong total.
   */
  private static async querySignups(period: MonthPeriod): Promise<{ registered: number | null; byChannel: Record<SignupChannel, number> | null }> {
    const monthStart = period.start;
    const rows = await prisma.$queryRaw<Array<{ channel: SignupChannel; new_accounts: number }>>`
      SELECT channel, "newAccounts" AS new_accounts FROM ultima_signup_monthly_counts WHERE month = ${monthStart}::date`;
    if (rows.length === 0) return { registered: null, byChannel: null };
    const [total] = await prisma.$queryRaw<Array<{ users: number }>>`
      SELECT COALESCE(SUM("newUsers"), 0)::int AS users FROM ultima_signup_monthly_counts WHERE month <= ${monthStart}::date`;
    const byChannel: Record<SignupChannel, number> = { WEB: 0, ANDROID: 0, IOS: 0, MTN_USSD: 0, AIRTEL_USSD: 0, OTHER: 0 };
    for (const r of rows) byChannel[r.channel] = r.new_accounts;
    return { registered: total.users, byChannel };
  }

  private static async queryFundedGoals(period: MonthPeriod): Promise<number> {
    const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM insights.goal_holding_snapshots
      WHERE as_of_date = ${period.end}::date AND is_funded`;
    return row?.n ?? 0;
  }
}

interface MonthPeriod {
  start: string;
  end: string;
  previousEnd: string;
}

/** First and last day of a YYYY-MM month and the previous month-end, as YYYY-MM-DD. */
function monthPeriod(month: string): MonthPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestError('month must be in YYYY-MM format');
  const [y, m] = month.split('-').map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: `${month}-01`,
    end: iso(new Date(Date.UTC(y, m, 0))),
    previousEnd: iso(new Date(Date.UTC(y, m - 1, 0))),
  };
}

/** Every YYYY-MM month from `from` to `to` inclusive. */
function monthsBetween(from: string, to: string): string[] {
  monthPeriod(from);
  monthPeriod(to);
  if (from > to) throw new BadRequestError('from must not be after to');
  const months: string[] = [];
  let [y, m] = from.split('-').map(Number);
  for (let current = from; current <= to; ) {
    months.push(current);
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y += 1;
    current = `${y}-${String(m).padStart(2, '0')}`;
  }
  return months;
}

// B2B2C Others has no data source, so its figures stay null (blank in the report) rather than 0
function emptyLineMetrics(line: BusinessLine): BusinessLineMetrics {
  const start = line === 'B2B2C_OTHERS' ? null : 0;
  return {
    activeAccounts: start,
    newActiveAccounts: start,
    churnedAccounts: start,
    aum: start,
    depositValue: start,
    withdrawalValue: start,
    depositVolume: start,
    withdrawalVolume: start,
  };
}
