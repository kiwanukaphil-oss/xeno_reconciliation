import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

export type InsightSegment = 'INDIVIDUAL' | 'INSTITUTIONAL' | 'ALL';

/** Groups smaller than this are folded together so no small group can be singled out. */
export const MIN_REPORTABLE_GROUP_SIZE = 5;
const UNKNOWN_KEY = 'UNKNOWN';
const TOP_DISTRICTS = 15;

export interface BreakdownRow {
  key: string;
  accounts: number;
  aum: number;
  shareOfAccounts: number;
  shareOfAum: number;
  medianBalance: number | null;
  averageBalance: number | null;
}

export interface Breakdown {
  dimension: string;
  label: string;
  rows: BreakdownRow[];
  knownShareOfAccounts: number;
  knownShareOfAum: number;
}

interface DimensionDefinition {
  dimension: string;
  label: string;
  expression: string; // fixed SQL over account_profile_aum columns - never user input
  topN?: number;
  foldLabel?: string;
  extraWhere?: string;
  noUnknown?: boolean;
}

// Balance and saving-frequency bands are defined once here and reused by the impact pack
export const BALANCE_BAND_SQL = `CASE
  WHEN aum < 50000 THEN '1. Under 50k'
  WHEN aum < 500000 THEN '2. 50k - 500k'
  WHEN aum < 5000000 THEN '3. 500k - 5m'
  WHEN aum < 50000000 THEN '4. 5m - 50m'
  ELSE '5. 50m and above' END`;

export const DEPOSIT_FREQUENCY_SQL = `CASE
  WHEN deposit_months_12m = 0 THEN '1. No deposit in 12 months'
  WHEN deposit_months_12m <= 3 THEN '2. 1-3 months'
  WHEN deposit_months_12m <= 6 THEN '3. 4-6 months'
  WHEN deposit_months_12m <= 9 THEN '4. 7-9 months'
  ELSE '5. 10-12 months' END`;

const AGE_BAND_ORDER = ['Under 18', '18-25', '26-35', '36-45', '46-55', '56-65', '65+'];

/** Ordered scales (age, balance, frequency) keep their natural order; everything else ranks by AUM. */
function compareBreakdownKeys(dimension: string, a: { key: string; aum: number }, b: { key: string; aum: number }): number {
  if (dimension === 'ageBand') return AGE_BAND_ORDER.indexOf(a.key) - AGE_BAND_ORDER.indexOf(b.key);
  if (dimension === 'balanceBand' || dimension === 'depositFrequency') return String(a.key).localeCompare(String(b.key));
  return b.aum - a.aum;
}

const DIMENSIONS: DimensionDefinition[] = [
  { dimension: 'gender', label: 'Gender', expression: 'gender' },
  { dimension: 'ageBand', label: 'Age band', expression: 'age_band' },
  { dimension: 'locationGroup', label: 'Location', expression: 'location_group' },
  {
    dimension: 'region',
    label: 'Region',
    expression: `COALESCE(region, CASE WHEN location_status = 'ABROAD' THEN 'ABROAD' ELSE '${UNKNOWN_KEY}' END)`,
  },
  {
    dimension: 'district',
    label: 'District (top 15)',
    expression: `COALESCE(district, '${UNKNOWN_KEY}')`,
    topN: TOP_DISTRICTS,
    foldLabel: 'Other districts',
  },
  {
    dimension: 'abroadCountry',
    label: 'Clients abroad by country',
    expression: 'country',
    extraWhere: `location_status = 'ABROAD'`,
    noUnknown: true,
  },
  { dimension: 'signupChannel', label: 'Sign-up channel', expression: 'signup_channel' },
  { dimension: 'phoneNetwork', label: 'Phone network', expression: 'phone_network' },
  { dimension: 'accountType', label: 'Account type', expression: 'account_type', noUnknown: true },
  { dimension: 'balanceBand', label: 'Balance band', expression: BALANCE_BAND_SQL, noUnknown: true },
  { dimension: 'depositFrequency', label: 'Months with a deposit (last 12)', expression: DEPOSIT_FREQUENCY_SQL, noUnknown: true },
];

/**
 * Client composition reporting over the account_profile_aum view.
 * Every figure covers funded accounts (balance >= UGX 5,000, the Dashboard's definition).
 */
export class ClientInsightsService {
  static segmentCondition(segment: InsightSegment): Prisma.Sql {
    return segment === 'ALL' ? Prisma.sql`TRUE` : Prisma.sql`segment = ${segment}`;
  }

  /** Headline figures plus every breakdown for the chosen segment. */
  static async getSummary(segment: InsightSegment) {
    const where = this.segmentCondition(segment);
    const [kpi] = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS accounts,
             COALESCE(SUM(aum), 0)::float8 AS aum,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY aum)::float8 AS median_balance,
             COUNT(*) FILTER (WHERE deposits_12m > 0)::int AS depositors_12m,
             COUNT(*) FILTER (WHERE gender IN ('MALE', 'FEMALE'))::int AS gender_known,
             COALESCE(SUM(aum) FILTER (WHERE gender IN ('MALE', 'FEMALE')), 0)::float8 AS gender_known_aum,
             MIN(price_as_of)::text AS price_as_of,
             MIN(data_as_of)::text AS data_as_of
      FROM account_profile_aum
      WHERE is_funded AND ${where}`;

    const breakdowns = await Promise.all(DIMENSIONS.map((d) => this.getBreakdown(d, segment)));
    return {
      segment,
      asOf: { prices: kpi.price_as_of, transactions: kpi.data_as_of },
      kpis: {
        fundedAccounts: kpi.accounts,
        aum: kpi.aum,
        medianBalance: kpi.median_balance,
        depositorsLast12Months: kpi.depositors_12m,
        genderKnownShareOfAccounts: kpi.accounts ? kpi.gender_known / kpi.accounts : 0,
        genderKnownShareOfAum: kpi.aum ? kpi.gender_known_aum / kpi.aum : 0,
      },
      breakdowns,
    };
  }

  static async getBreakdownByName(dimension: string, segment: InsightSegment): Promise<Breakdown> {
    const definition = DIMENSIONS.find((d) => d.dimension === dimension);
    if (!definition) throw new Error(`Unknown dimension: ${dimension}`);
    return this.getBreakdown(definition, segment);
  }

  /**
   * Groups funded accounts by one dimension. Groups below the minimum size, and
   * groups beyond topN, are folded into one "other" row (whose median is not shown,
   * as it cannot be derived from the parts). Rows are sorted by AUM with UNKNOWN last.
   */
  private static async getBreakdown(definition: DimensionDefinition, segment: InsightSegment): Promise<Breakdown> {
    const extra = definition.extraWhere ? Prisma.raw(`AND ${definition.extraWhere}`) : Prisma.empty;
    const raw = await prisma.$queryRaw<any[]>`
      SELECT ${Prisma.raw(definition.expression)} AS key,
             COUNT(*)::int AS accounts,
             COALESCE(SUM(aum), 0)::float8 AS aum,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY aum)::float8 AS median_balance,
             AVG(aum)::float8 AS average_balance
      FROM account_profile_aum
      WHERE is_funded AND ${this.segmentCondition(segment)} ${extra}
      GROUP BY 1`;

    const totalAccounts = raw.reduce((s, r) => s + r.accounts, 0);
    const totalAum = raw.reduce((s, r) => s + r.aum, 0);
    const known = raw.filter((r) => r.key && r.key !== UNKNOWN_KEY);
    const unknown = raw.filter((r) => !r.key || r.key === UNKNOWN_KEY);

    known.sort((a, b) => compareBreakdownKeys(definition.dimension, a, b));
    const shown = known.filter((r, i) => r.accounts >= MIN_REPORTABLE_GROUP_SIZE && (!definition.topN || i < definition.topN));
    const folded = known.filter((r) => !shown.includes(r));

    const toRow = (key: string, accounts: number, aum: number, median: number | null, average: number | null): BreakdownRow => ({
      key,
      accounts,
      aum,
      shareOfAccounts: totalAccounts ? accounts / totalAccounts : 0,
      shareOfAum: totalAum ? aum / totalAum : 0,
      medianBalance: median,
      averageBalance: average,
    });

    const rows = shown.map((r) => toRow(String(r.key), r.accounts, r.aum, r.median_balance, r.average_balance));
    if (folded.length) {
      const accounts = folded.reduce((s, r) => s + r.accounts, 0);
      const aum = folded.reduce((s, r) => s + r.aum, 0);
      rows.push(toRow(definition.foldLabel ?? `Other (groups under ${MIN_REPORTABLE_GROUP_SIZE})`, accounts, aum, null, aum / accounts));
    }
    if (unknown.length && !definition.noUnknown) {
      const accounts = unknown.reduce((s, r) => s + r.accounts, 0);
      const aum = unknown.reduce((s, r) => s + r.aum, 0);
      rows.push(toRow(UNKNOWN_KEY, accounts, aum, unknown.length === 1 ? unknown[0].median_balance : null, aum / accounts));
    }

    const unknownAccounts = unknown.reduce((s, r) => s + r.accounts, 0);
    const unknownAum = unknown.reduce((s, r) => s + r.aum, 0);
    return {
      dimension: definition.dimension,
      label: definition.label,
      rows,
      knownShareOfAccounts: totalAccounts ? 1 - unknownAccounts / totalAccounts : 0,
      knownShareOfAum: totalAum ? 1 - unknownAum / totalAum : 0,
    };
  }

  /**
   * Where profile data is missing or doubtful, ranked by how much AUM it affects:
   * field completeness, operational flags, the largest accounts missing data, and
   * district text that could not be matched (to extend the lookup lists).
   */
  static async getDataQuality(segment: InsightSegment, limit: number) {
    const where = this.segmentCondition(segment);
    const [c] = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS accounts, COALESCE(SUM(aum), 0)::float8 AS aum,
        COUNT(*) FILTER (WHERE gender IN ('MALE', 'FEMALE', 'UNDISCLOSED'))::int AS gender_n,
        COALESCE(SUM(aum) FILTER (WHERE gender IN ('MALE', 'FEMALE', 'UNDISCLOSED')), 0)::float8 AS gender_aum,
        COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL)::int AS dob_n,
        COALESCE(SUM(aum) FILTER (WHERE date_of_birth IS NOT NULL), 0)::float8 AS dob_aum,
        COUNT(*) FILTER (WHERE location_group <> 'UNKNOWN')::int AS location_n,
        COALESCE(SUM(aum) FILTER (WHERE location_group <> 'UNKNOWN'), 0)::float8 AS location_aum,
        COUNT(*) FILTER (WHERE signup_channel <> 'UNKNOWN')::int AS channel_n,
        COALESCE(SUM(aum) FILTER (WHERE signup_channel <> 'UNKNOWN'), 0)::float8 AS channel_aum,
        COUNT(*) FILTER (WHERE NOT has_profile)::int AS no_profile_n,
        COALESCE(SUM(aum) FILTER (WHERE NOT has_profile), 0)::float8 AS no_profile_aum,
        COUNT(*) FILTER (WHERE contact_closed)::int AS closed_n,
        COALESCE(SUM(aum) FILTER (WHERE contact_closed), 0)::float8 AS closed_aum,
        COUNT(*) FILTER (WHERE portal_enabled = false)::int AS disabled_n,
        COALESCE(SUM(aum) FILTER (WHERE portal_enabled = false), 0)::float8 AS disabled_aum
      FROM account_profile_aum WHERE is_funded AND ${where}`;

    const field = (name: string, n: number, aum: number) => ({
      field: name,
      knownAccounts: n,
      knownShareOfAccounts: c.accounts ? n / c.accounts : 0,
      knownShareOfAum: c.aum ? aum / c.aum : 0,
    });

    const largestMissing = await prisma.$queryRaw<any[]>`
      SELECT account_number, account_type, aum::float8 AS aum,
             ARRAY_REMOVE(ARRAY[
               CASE WHEN gender = 'UNKNOWN' THEN 'gender' END,
               CASE WHEN date_of_birth IS NULL THEN 'date of birth' END,
               CASE WHEN location_group = 'UNKNOWN' THEN 'location' END
             ], NULL) AS missing
      FROM account_profile_aum
      WHERE is_funded AND ${where}
        AND (gender = 'UNKNOWN' OR date_of_birth IS NULL OR location_group = 'UNKNOWN')
      ORDER BY aum DESC
      LIMIT ${limit}`;

    const unmatchedDistricts = await prisma.$queryRaw<any[]>`
      SELECT LOWER(TRIM("districtRaw")) AS value, COUNT(*)::int AS accounts
      FROM account_profiles WHERE "locationStatus" = 'UNMATCHED' AND "districtRaw" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 40`;

    return {
      segment,
      fundedAccounts: c.accounts,
      aum: c.aum,
      completeness: [
        field('Gender', c.gender_n, c.gender_aum),
        field('Date of birth', c.dob_n, c.dob_aum),
        field('Location', c.location_n, c.location_aum),
        field('Sign-up channel', c.channel_n, c.channel_aum),
      ],
      flags: [
        { flag: 'No Ultima profile', accounts: c.no_profile_n, aum: c.no_profile_aum },
        { flag: 'Ultima user closed (phone marked closed_)', accounts: c.closed_n, aum: c.closed_aum },
        { flag: 'Ultima account disabled', accounts: c.disabled_n, aum: c.disabled_aum },
      ],
      largestAccountsMissingData: largestMissing.map((r) => ({
        accountNumber: r.account_number,
        accountType: r.account_type,
        aum: r.aum,
        missing: r.missing,
      })),
      unmatchedDistricts,
    };
  }
}
