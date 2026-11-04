import { Writable } from 'stream';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { InsightSegment } from './ClientInsightsService';
import { InsightSources, LATEST_SOURCES } from './InsightSources';

export type DirectoryFundedFilter = 'FUNDED' | 'UNFUNDED' | 'ALL';
export type DirectoryMissingFilter = 'ANY' | 'GENDER' | 'DATE_OF_BIRTH' | 'LOCATION' | 'NO_PROFILE';
export type DirectorySort = 'balance' | 'name' | 'lastDeposit' | 'accountNumber';
/** Where an account's gender comes from, or why it has none. */
export type GenderEstimateStatus = 'DECLARED' | 'RATHER_NOT_SAY' | 'ESTIMATED' | 'LOW_CONFIDENCE' | 'NOT_ESTIMABLE';
export type DirectoryEstimateFilter = 'ESTIMATED' | 'LOW_CONFIDENCE' | 'NOT_ESTIMABLE';

export interface AccountDirectoryFilters {
  search?: string;
  segment: InsightSegment;
  funded: DirectoryFundedFilter;
  channel?: string;
  missing?: DirectoryMissingFilter;
  gender?: string; // declared gender
  genderEstimate?: DirectoryEstimateFilter; // among accounts with no declared gender
  minBalance?: number;
}

export interface AccountDirectoryPage {
  page: number;
  pageSize: number;
  sort: DirectorySort;
  direction: 'asc' | 'desc';
  totalAccounts: number;
  totalAum: number;
  asOf: string | null;
  rows: AccountDirectoryRow[];
}

export interface AccountDirectoryRow {
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  clientName: string;
  balance: number;
  isFunded: boolean;
  gender: string;
  genderEstimate: {
    status: GenderEstimateStatus;
    gender: 'FEMALE' | 'MALE' | null; // likelier gender, for ESTIMATED and LOW_CONFIDENCE
    confidence: number | null; // probability of that gender
    note: string | null; // why there is no estimate
  };
  ageYears: number | null;
  location: string | null;
  region: string | null;
  signupChannel: string;
  phoneNetwork: string;
  lastDepositDate: string | null;
  depositsLast12Months: number;
  contactClosed: boolean;
  missing: string[];
}

export const MAX_PAGE_SIZE = 200;
const EXPORT_BATCH_SIZE = 5000;
const EXPORT_MAX_ROWS = 250000;
const ACCOUNT_NUMBER_SEARCH = /^[0-9][0-9-]*$/;

// Fixed SQL per sort key - never built from user input
const SORT_SQL: Record<DirectorySort, (dir: 'ASC' | 'DESC') => string> = {
  balance: (dir) => `v.aum ${dir}, v.account_id ${dir}`,
  name: (dir) => `c."clientName" ${dir}, v.account_id ${dir}`,
  lastDeposit: (dir) => `v.last_deposit_date ${dir} NULLS LAST, v.account_id ${dir}`,
  accountNumber: (dir) => `v.account_number ${dir}`,
};

// The same orders over the already-selected page (columns of the "page" CTE)
const PAGE_SORT_SQL: Record<DirectorySort, (dir: 'ASC' | 'DESC') => string> = {
  balance: (dir) => `page.balance ${dir}, page.account_id ${dir}`,
  name: (dir) => `client_name ${dir}, page.account_id ${dir}`,
  lastDeposit: (dir) => `page.last_deposit_date ${dir} NULLS LAST, page.account_id ${dir}`,
  accountNumber: (dir) => `page.account_number ${dir}`,
};

// Accounts without a declared gender, by what the name-based estimator could do for them
const ESTIMATE_SQL: Record<DirectoryEstimateFilter, string> = {
  ESTIMATED: `(v.gender = 'UNKNOWN' AND v.gender_basis = 'ESTIMATED')`,
  LOW_CONFIDENCE: `(v.gender = 'UNKNOWN' AND v.gender_basis = 'UNKNOWN' AND v.female_probability IS NOT NULL)`,
  NOT_ESTIMABLE: `(v.gender = 'UNKNOWN' AND v.female_probability IS NULL)`,
};

const MISSING_SQL: Record<DirectoryMissingFilter, string> = {
  ANY: `(NOT v.has_profile OR v.gender = 'UNKNOWN' OR v.date_of_birth IS NULL OR v.location_group = 'UNKNOWN')`,
  GENDER: `v.gender = 'UNKNOWN'`,
  DATE_OF_BIRTH: `v.date_of_birth IS NULL`,
  LOCATION: `v.location_group = 'UNKNOWN'`,
  NO_PROFILE: `NOT v.has_profile`,
};

// Columns read for list rows and the export (v = account_profile_aum)
const ROW_COLUMNS = Prisma.raw(`
  v.account_id, v.account_number, v.account_type, v.account_category, v.client_id,
  v.aum::float8 AS balance, v.aum::text AS balance_exact, v.is_funded, v.has_profile,
  v.gender, v.gender_basis, v.female_probability, v.date_of_birth IS NULL AS no_dob, v.age_years, v.location_group,
  v.district, v.region, v.country, v.location_status, v.signup_channel, v.phone_network,
  v.last_deposit_date::text AS last_deposit_date, v.deposits_12m, v.contact_closed`);

/**
 * Searchable, paged list of accounts with their Ultima profile, for KYC follow-up
 * and lookups. Built for ~100k+ accounts:
 * - every filter runs against indexed columns of the account_profile_aum view;
 * - name search is a semi-join through a trigram index on clients, so a match on
 *   a few clients touches only their accounts;
 * - the page is selected before client names are joined, so only one page of
 *   rows is ever joined;
 * - the export streams batches by keyset (balance, account id) rather than OFFSET.
 */
export class AccountDirectoryService {
  static async listAccounts(
    filters: AccountDirectoryFilters,
    options: { page: number; pageSize: number; sort: DirectorySort; direction: 'asc' | 'desc' },
    sources: InsightSources = LATEST_SOURCES
  ): Promise<AccountDirectoryPage> {
    const where = this.buildWhere(filters);
    const pageSize = Math.min(Math.max(options.pageSize, 1), MAX_PAGE_SIZE);
    const page = Math.max(options.page, 1);
    const dir = options.direction === 'asc' ? 'ASC' : 'DESC';
    const order = Prisma.raw(SORT_SQL[options.sort](dir));
    const pageOrder = Prisma.raw(PAGE_SORT_SQL[options.sort](dir));
    // Sorting by name needs the join inside the page query; other sorts join after paging
    const pageJoin = options.sort === 'name' ? Prisma.sql`JOIN clients c ON c.id = v.client_id` : Prisma.empty;

    const [rows, [totals]] = await Promise.all([
      prisma.$queryRaw<any[]>`
        WITH page AS (
          SELECT ${ROW_COLUMNS}
          FROM ${sources.accounts('v')} ${pageJoin}
          WHERE ${where}
          ORDER BY ${order}
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        )
        SELECT page.*, c."clientName" AS client_name
        FROM page JOIN clients c ON c.id = page.client_id
        ORDER BY ${pageOrder}`,
      prisma.$queryRaw<any[]>`
        SELECT COUNT(*)::int AS accounts, COALESCE(SUM(v.aum), 0)::float8 AS aum
        FROM ${sources.accounts('v')}
        WHERE ${where}`,
    ]);

    return {
      page,
      pageSize,
      sort: options.sort,
      direction: options.direction,
      totalAccounts: totals.accounts,
      totalAum: totals.aum,
      asOf: sources.asOf,
      rows: rows.map(toDirectoryRow),
    };
  }

  /**
   * One account's full profile, plus each goal's value, fund mix against the Ultima
   * target and the latest Ultima goal snapshot. Returns null if the account is unknown (or, for a
   * past as-at date, had no transactions yet).
   */
  static async getAccountDetail(accountNumber: string, sources: InsightSources = LATEST_SOURCES) {
    const [account] = await prisma.$queryRaw<any[]>`
      SELECT ${ROW_COLUMNS}, c."clientName" AS client_name, c."clientCode" AS client_code,
             v.date_of_birth::text AS date_of_birth, v.equity_value::float8 AS equity_value,
             v.first_deposit_date::text AS first_deposit_date, v.last_withdrawal_date::text AS last_withdrawal_date,
             v.deposit_count, v.deposit_total::float8 AS deposit_total, v.withdrawal_count,
             v.withdrawal_total::float8 AS withdrawal_total, v.deposit_amount_12m::float8 AS deposit_amount_12m,
             v.signup_platform, v.portal_enabled, v.user_joined_at::text AS user_joined_at, v.avg_risk_score::float8 AS avg_risk_score,
             ap."districtRaw" AS district_raw, ap."sponsorAccountNumber" AS sponsor_account_number,
             ap."institutionName" AS institution_name, ap."enrollmentStatus" AS enrollment_status
      FROM ${sources.accounts('v')}
      JOIN clients c ON c.id = v.client_id
      LEFT JOIN account_profiles ap ON ap."accountId" = v.account_id
      WHERE v.account_number = ${accountNumber}`;
    if (!account) return null;

    const goals = await prisma.$queryRaw<any[]>`
      SELECT gh.goal_number, g."goalTitle" AS goal_title, gh.goal_category, gh.risk_score,
             gh.total_value::float8 AS value, gh.is_funded,
             gh.xummf_pct::float8 AS xummf_pct, gh.xubf_pct::float8 AS xubf_pct,
             gh.xudef_pct::float8 AS xudef_pct, gh.xuref_pct::float8 AS xuref_pct,
             gh.target_xummf_pct::float8 AS target_xummf_pct, gh.target_xubf_pct::float8 AS target_xubf_pct,
             gh.target_xudef_pct::float8 AS target_xudef_pct, gh.target_xuref_pct::float8 AS target_xuref_pct,
             gh.equity_gap_pp::float8 AS equity_gap_pp,
             s."goalTarget"::float8 AS ultima_target, s."currentValue"::float8 AS ultima_value, s."asOfDate"::text AS ultima_as_of
      FROM ${sources.goalHoldings('gh')}
      JOIN goals g ON g.id = gh.goal_id
      LEFT JOIN LATERAL (
        SELECT "goalTarget", "currentValue", "asOfDate" FROM ultima_goal_snapshots
        WHERE "goalId" = g.id ORDER BY "asOfDate" DESC LIMIT 1
      ) s ON TRUE
      WHERE gh.account_id = ${account.account_id}
      ORDER BY gh.total_value DESC`;

    return {
      ...toDirectoryRow(account),
      asOf: sources.asOf,
      clientCode: account.client_code,
      dateOfBirth: account.date_of_birth,
      districtRaw: account.district_raw,
      country: account.country,
      signupPlatform: account.signup_platform,
      portalEnabled: account.portal_enabled,
      enrollmentStatus: account.enrollment_status,
      userJoinedAt: account.user_joined_at,
      sponsorAccountNumber: account.sponsor_account_number,
      institutionName: account.institution_name,
      equityValue: account.equity_value,
      averageRiskScore: account.avg_risk_score,
      activity: {
        firstDepositDate: account.first_deposit_date,
        lastWithdrawalDate: account.last_withdrawal_date,
        depositCount: account.deposit_count,
        depositTotal: account.deposit_total,
        withdrawalCount: account.withdrawal_count,
        withdrawalTotal: account.withdrawal_total,
        depositAmountLast12Months: account.deposit_amount_12m,
      },
      goals: goals.map((g) => ({
        goalNumber: g.goal_number,
        goalTitle: g.goal_title,
        category: g.goal_category,
        riskScore: g.risk_score,
        value: g.value,
        isFunded: g.is_funded,
        actualPct: { XUMMF: g.xummf_pct, XUBF: g.xubf_pct, XUDEF: g.xudef_pct, XUREF: g.xuref_pct },
        targetPct: { XUMMF: g.target_xummf_pct, XUBF: g.target_xubf_pct, XUDEF: g.target_xudef_pct, XUREF: g.target_xuref_pct },
        equityGapPp: g.equity_gap_pp,
        ultimaTarget: g.ultima_target,
        ultimaValue: g.ultima_value,
        ultimaAsOf: g.ultima_as_of,
      })),
    };
  }

  /**
   * Streams every matching account to an Excel workbook, largest balance first.
   * Rows are read in batches by keyset on (balance, account id), so memory stays flat
   * and late batches cost the same as early ones. Stops early if the client
   * disconnects. An "About" sheet records the as-at date and filters. Returns the number of rows written.
   */
  static async streamAccountsWorkbook(
    filters: AccountDirectoryFilters,
    output: Writable,
    isCancelled: () => boolean,
    sources: InsightSources = LATEST_SOURCES
  ): Promise<number> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });
    const sheet = workbook.addWorksheet('Accounts', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Client', key: 'clientName', width: 32 },
      { header: 'Account number', key: 'accountNumber', width: 18 },
      { header: 'Account type', key: 'accountType', width: 14 },
      { header: 'Category', key: 'accountCategory', width: 24 },
      { header: 'Balance (UGX)', key: 'balance', width: 16, style: { numFmt: '#,##0' } },
      { header: 'Funded', key: 'funded', width: 8 },
      { header: 'Gender (declared)', key: 'gender', width: 16 },
      { header: 'Gender (estimated from name)', key: 'estimatedGender', width: 16 },
      { header: 'Estimate confidence', key: 'estimateConfidence', width: 12, style: { numFmt: '0%' } },
      { header: 'Estimate status', key: 'estimateStatus', width: 34 },
      { header: 'Age', key: 'ageYears', width: 6 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Region', key: 'region', width: 12 },
      { header: 'Sign-up channel', key: 'signupChannel', width: 14 },
      { header: 'Phone network', key: 'phoneNetwork', width: 14 },
      { header: 'Last deposit', key: 'lastDepositDate', width: 12 },
      { header: 'Deposits (12m)', key: 'depositsLast12Months', width: 12 },
      { header: 'Ultima user closed', key: 'contactClosed', width: 12 },
      { header: 'Missing', key: 'missing', width: 34 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();

    const where = this.buildWhere(filters);
    let cursor: { balance: string; accountId: string } | null = null;
    let written = 0;

    while (written < EXPORT_MAX_ROWS && !isCancelled()) {
      const after: Prisma.Sql = cursor
        ? Prisma.sql`AND (v.aum, v.account_id) < (${cursor.balance}::numeric, ${cursor.accountId})`
        : Prisma.empty;
      const batch = await prisma.$queryRaw<any[]>`
        WITH page AS (
          SELECT ${ROW_COLUMNS}
          FROM ${sources.accounts('v')}
          WHERE ${where} ${after}
          ORDER BY v.aum DESC, v.account_id DESC
          LIMIT ${Math.min(EXPORT_BATCH_SIZE, EXPORT_MAX_ROWS - written)}
        )
        SELECT page.*, c."clientName" AS client_name
        FROM page JOIN clients c ON c.id = page.client_id
        ORDER BY page.balance DESC, page.account_id DESC`;
      if (!batch.length) break;

      for (const raw of batch) {
        const row = toDirectoryRow(raw);
        sheet.addRow({
          ...row,
          funded: row.isFunded ? 'Yes' : 'No',
          estimatedGender: row.genderEstimate.gender ?? '',
          estimateConfidence: row.genderEstimate.confidence,
          estimateStatus: describeEstimateStatus(row.genderEstimate),
          contactClosed: row.contactClosed ? 'Yes' : '',
          missing: row.missing.join(', '),
        }).commit();
      }
      written += batch.length;
      const last = batch[batch.length - 1];
      cursor = { balance: last.balance_exact, accountId: last.account_id };
      if (batch.length < EXPORT_BATCH_SIZE) break;
    }

    sheet.commit();
    const about = workbook.addWorksheet('About');
    about.getColumn(1).width = 22;
    about.getColumn(2).width = 60;
    about.addRow(['Account profiles export']).commit();
    about.addRow(['As at', sources.asOf ?? 'Latest (all data in the system)']).commit();
    about.addRow(['Generated', new Date().toISOString().slice(0, 10)]).commit();
    about.addRow(['Filters', JSON.stringify(filters)]).commit();
    about.addRow(['Rows', written]).commit();
    about.addRow(['Note', 'Balances and activity are as at the date above; profile fields (gender, location, channel) are current Ultima values.']).commit();
    about.commit();
    await workbook.commit();
    return written;
  }

  /** SQL conditions for the filters; every value is bound as a parameter. */
  private static buildWhere(filters: AccountDirectoryFilters): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (filters.segment !== 'ALL') conditions.push(Prisma.sql`v.segment = ${filters.segment}`);
    if (filters.funded === 'FUNDED') conditions.push(Prisma.sql`v.is_funded`);
    if (filters.funded === 'UNFUNDED') conditions.push(Prisma.sql`NOT v.is_funded`);
    if (filters.channel) conditions.push(Prisma.sql`v.signup_channel = ${filters.channel}`);
    if (filters.gender) conditions.push(Prisma.sql`v.gender = ${filters.gender}`);
    if (filters.genderEstimate) conditions.push(Prisma.raw(ESTIMATE_SQL[filters.genderEstimate]));
    if (filters.missing) conditions.push(Prisma.raw(MISSING_SQL[filters.missing]));
    if (filters.minBalance !== undefined) conditions.push(Prisma.sql`v.aum >= ${filters.minBalance}`);

    const search = filters.search?.trim();
    if (search) {
      if (ACCOUNT_NUMBER_SEARCH.test(search)) {
        // Digits and dashes only, so no LIKE wildcards to escape
        conditions.push(Prisma.sql`v.account_number LIKE ${search + '%'}`);
      } else {
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        conditions.push(Prisma.sql`v.client_id IN (SELECT id FROM clients WHERE "clientName" ILIKE ${pattern})`);
      }
    }
    return conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`TRUE`;
  }
}

/** Maps a view row to the API shape and lists which profile fields are missing. */
function toDirectoryRow(r: any): AccountDirectoryRow {
  const missing: string[] = [];
  if (!r.has_profile) missing.push('Ultima profile');
  else {
    if (r.gender === 'UNKNOWN') missing.push('gender');
    if (r.no_dob) missing.push('date of birth');
    if (r.location_group === 'UNKNOWN') missing.push('location');
  }
  return {
    accountNumber: r.account_number,
    accountType: r.account_type,
    accountCategory: r.account_category,
    clientName: r.client_name,
    balance: r.balance,
    isFunded: r.is_funded,
    gender: r.gender,
    genderEstimate: readGenderEstimate(r),
    ageYears: r.age_years,
    location: r.district ?? (r.location_status === 'ABROAD' ? r.country : null),
    region: r.region ?? (r.location_status === 'ABROAD' ? 'ABROAD' : null),
    signupChannel: r.signup_channel,
    phoneNetwork: r.phone_network,
    lastDepositDate: r.last_deposit_date,
    depositsLast12Months: r.deposits_12m,
    contactClosed: r.contact_closed,
    missing,
  };
}

/**
 * Name-based gender estimate for an account with no declared gender: the likelier
 * gender and its probability, or the reason there is no estimate. Declared and
 * "rather not say" accounts are never estimated.
 */
function readGenderEstimate(r: any): AccountDirectoryRow['genderEstimate'] {
  if (r.gender === 'FEMALE' || r.gender === 'MALE') return { status: 'DECLARED', gender: null, confidence: null, note: null };
  if (r.gender === 'UNDISCLOSED') return { status: 'RATHER_NOT_SAY', gender: null, confidence: null, note: 'Client chose not to say' };
  if (r.female_probability === null || r.female_probability === undefined) {
    const note = r.account_type === 'PERSONAL' ? 'Name not recognised' : 'Only personal accounts are estimated';
    return { status: 'NOT_ESTIMABLE', gender: null, confidence: null, note };
  }
  const female = Number(r.female_probability);
  const likelier = female >= 0.5 ? 'FEMALE' : 'MALE';
  return {
    status: r.gender_basis === 'ESTIMATED' ? 'ESTIMATED' : 'LOW_CONFIDENCE',
    gender: likelier,
    confidence: likelier === 'FEMALE' ? female : 1 - female,
    note: null,
  };
}

/** Plain-language estimate status for the export. */
function describeEstimateStatus(estimate: AccountDirectoryRow['genderEstimate']): string {
  switch (estimate.status) {
    case 'DECLARED':
      return 'Declared (no estimate needed)';
    case 'RATHER_NOT_SAY':
      return 'Rather not say (not estimated)';
    case 'ESTIMATED':
      return 'Estimated (90%+ confident)';
    case 'LOW_CONFIDENCE':
      return 'Low confidence (below 90%)';
    default:
      return `No estimate: ${estimate.note}`;
  }
}
