import {
  BUSINESS_LINES,
  BusinessLine,
  CUSTOMER_GROUPS,
  CustomerGroup,
  INFLOW_CHANNELS,
  WEALTH_BANDS,
  UgMonthlyMetrics,
} from './UgMonthlyMetricsService';

/**
 * Row-for-row layout of the "Inputs-UG" sheet of the monthly XENO_Metrics report. Row numbers match
 * the original workbook, so a month's column can be pasted straight across. Each row is one of:
 * - header:  a section label, no values
 * - system:  computed from the system (UgMonthlyMetricsService)
 * - formula: derived from other rows; written to Excel as a live formula and evaluated for the page
 * - manual:  the system has no input for it; left blank to be filled in by hand
 * Rows 378-406 of the original (blank business-line ratio sections) are not reproduced.
 */

export type UgRowKind = 'header' | 'system' | 'formula' | 'manual';
export type UgRowFormat = 'int' | 'ugx' | 'pct' | 'avg' | 'rate';

/** A formula built once and rendered both ways: Excel text ({c} = this month's column) and a JS evaluation. */
interface Expr {
  xl: string;
  js: (value: RowValue) => number | null;
}
type RowValue = (row: number) => number | null;

export interface UgRowDef {
  row: number;
  band?: string;
  label: string;
  kind: UgRowKind;
  format?: UgRowFormat;
  /** For system rows. */
  pick?: (m: UgMonthlyMetrics) => number | null;
  /** For formula rows. */
  expr?: Expr;
  /** For manual rows: where the figure comes from. */
  source?: string;
  /** For manual rows: stable key the hand-entered value is stored under (independent of the row number). */
  key?: string;
}

// --- Formula builders. Blank cells count as 0 in sums, as Excel does; a sum of only blanks stays blank. ---
const ref = (row: number): Expr => ({ xl: `{c}${row}`, js: (v) => v(row) });

const sumOf = (...parts: Expr[]): Expr => ({
  xl: parts.map((p) => p.xl).join('+'),
  js: (v) => {
    const values = parts.map((p) => p.js(v));
    return values.every((x) => x === null) ? null : values.reduce<number>((s, x) => s + (x ?? 0), 0);
  },
});

const sumRange = (from: number, to: number): Expr => ({
  xl: `SUM({c}${from}:{c}${to})`,
  js: sumOf(...rowsBetween(from, to).map(ref)).js,
});

const minus = (a: Expr, b: Expr): Expr => ({
  xl: `(${a.xl}-${b.xl})`,
  js: (v) => {
    const x = a.js(v), y = b.js(v);
    return x === null && y === null ? null : (x ?? 0) - (y ?? 0);
  },
});

/** Division wrapped in IFERROR, so an empty or zero denominator shows blank rather than #DIV/0!. */
const ratio = (num: Expr, den: Expr, offset = 0): Expr => ({
  xl: `IFERROR(${num.xl}/${den.xl}${offset ? `${offset > 0 ? '+' : ''}${offset}` : ''},"")`,
  js: (v) => {
    const n = num.js(v), d = den.js(v);
    return n === null || d === null || d === 0 ? null : n / d + offset;
  },
});

function rowsBetween(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// --- Row builders ---
const header = (row: number, label: string): UgRowDef => ({ row, label, kind: 'header' });
const system = (row: number, label: string, pick: UgRowDef['pick'], format: UgRowFormat = 'int', band?: string): UgRowDef => ({
  row, label, kind: 'system', pick, format, band,
});
const formula = (row: number, label: string, expr: Expr, format: UgRowFormat): UgRowDef => ({ row, label, kind: 'formula', expr, format });
const manual = (row: number, key: string, label: string, source: string, format: UgRowFormat = 'ugx'): UgRowDef => ({
  row, key, label, kind: 'manual', source, format,
});

const INFLOW_LABELS = ['Bank', 'MTN - Web', 'MTN - USSD', 'MTN - App', 'Airtel - Web', 'Airtel - USSD', 'Airtel - App', 'Other'];
const OUTFLOW_LABELS = ['Bank', 'MTN', 'Airtel'] as const;
const OUTFLOW_KEYS = ['BANK', 'MTN', 'AIRTEL'] as const;
const GROUP_LABELS: Record<CustomerGroup, string> = { INDIVIDUALS: 'Individuals', GROUPS: 'Groups', INSTITUTIONS: 'Institutions' };
const LINE_LABELS: Record<BusinessLine, string> = {
  B2C_INDIVIDUALS: '1: B2C: Individuals',
  B2B_GROUPS: '2: B2B: Groups',
  B2B_CORPORATE_TREASURY: '3: B2B Corporate Treasury',
  B2B_RETIREMENT_SCHEMES: '4: B2B Retirement Schemes',
  B2B2C_TELCO: '5: B2B2C: Partnerships - Telco',
  B2B2C_OTHERS: '6: B2B2C: Partnerships - Others',
};

const LEDGER_SOURCE = 'Accounting system / general ledger';
const AUTOSAVE_SOURCE = 'Ultima standing orders (not loaded)';

/** "Other" inflow value is not a row of its own: it is Total less the named channels. */
const otherInflowValue = minus(ref(88), sumRange(81, 87));

/** One row per channel for "New Funded" (value or volume), in the sheet's channel order. */
function newFundedRows(firstRow: number, measure: 'value' | 'volume'): UgRowDef[] {
  return INFLOW_CHANNELS.map((channel, i) =>
    system(firstRow + i, `New Funded: ${INFLOW_LABELS[i]}`, (m) => m.newFunded[measure][channel], measure === 'value' ? 'ugx' : 'int')
  );
}

/** One row per business line for a business-line measure (named by measureKey), starting at firstRow. */
function businessLineRows(
  firstRow: number,
  measureKey: string,
  pick: (m: UgMonthlyMetrics, line: BusinessLine) => number | null,
  format: UgRowFormat
): UgRowDef[] {
  return BUSINESS_LINES.map((line, i) => ({
    ...system(firstRow + i, LINE_LABELS[line], (m) => pick(m, line), format),
    // Partnerships - Others has no partner field in the data
    ...(line === 'B2B2C_OTHERS' ? { kind: 'manual' as const, pick: undefined, key: `b2b2c_others_${measureKey}`, source: 'No partner field in the data' } : {}),
  }));
}

/** One row per customer group (Individuals, Groups, Institutions), starting at firstRow. */
function customerGroupRows(firstRow: number, pick: (m: UgMonthlyMetrics, group: CustomerGroup) => number, format: UgRowFormat): UgRowDef[] {
  return CUSTOMER_GROUPS.map((group, i) => system(firstRow + i, GROUP_LABELS[group], (m) => pick(m, group), format));
}

/**
 * Average-per-transaction rows for the eight inflow channels: value row / volume row. The "Other"
 * channel uses otherValue (when the sheet has no separate value row for it).
 */
function averageRows(firstRow: number, valueRow: number, volumeRow: number, labelPrefix: string, otherValue?: Expr): UgRowDef[] {
  return INFLOW_LABELS.map((label, i) => {
    const value = i === 7 && otherValue ? otherValue : ref(valueRow + i);
    return formula(firstRow + i, `${labelPrefix}${label}`, ratio(value, ref(volumeRow + i)), 'avg');
  });
}

export const UG_ROWS: UgRowDef[] = [
  manual(4, 'usd_ugx', 'USD/UGX', 'Bank of Uganda', 'rate'),
  header(5, 'Source: Bank of Uganda'),
  system(7, 'Registered', (m) => m.headline.registered),
  system(8, 'Active Accounts', (m) => m.headline.activeAccounts),
  system(9, 'AUM', (m) => m.headline.aum, 'ugx'),
  system(10, 'Customer Retention (Since Inception)', (m) => m.headline.retentionSinceInception, 'pct'),
  system(11, 'Change in Active Accounts', (m) => m.headline.newFundedAccounts - m.headline.closedAccounts),
  manual(12, 'spend', 'Spend', LEDGER_SOURCE),
  formula(13, 'Revenue', ref(25), 'ugx'),
  formula(14, 'Liquid Assets', sumRange(17, 18), 'ugx'),

  header(16, 'Liquid Assets'),
  manual(17, 'xeno_uganda_aum', 'XENO Uganda-AUM', LEDGER_SOURCE),
  formula(18, 'Bank', sumOf(ref(35), ref(36)), 'ugx'),

  header(20, 'Revenue'),
  manual(21, 'revenue_xeno_uganda_gains', 'XENO Uganda - Gains', LEDGER_SOURCE),
  manual(22, 'revenue_distribution_fees', 'Distribution Fees', LEDGER_SOURCE),
  manual(23, 'revenue_management_fees', 'Management Fees', LEDGER_SOURCE),
  manual(24, 'revenue_other', 'Other', LEDGER_SOURCE),
  formula(25, 'Total', sumRange(21, 24), 'ugx'),

  formula(27, 'Expense Category', sumOf(ref(28), ref(29)), 'ugx'),
  manual(28, 'sales_costs', 'Sales Costs', LEDGER_SOURCE),
  manual(29, 'marketing_costs', 'Marketing Costs', LEDGER_SOURCE),
  manual(30, 'sales_payroll', 'Sales Payroll', 'Payroll'),
  manual(31, 'marketing_payroll', 'Marketing Payroll', 'Payroll'),
  formula(32, 'Total CAC', sumRange(28, 31), 'ugx'),

  header(34, 'Bank Accounts'),
  manual(35, 'bank_stanbic_ugx', 'XENO Investment - Stanbic [UGX]', 'Bank statement'),
  manual(36, 'bank_stanbic_usd', 'XENO Investment - Stanbic [USD]', 'Bank statement'),

  system(38, 'New Registered', (m) => m.headline.newRegistered),
  system(39, 'New Funded Accounts', (m) => m.headline.newFundedAccounts),
  system(40, 'Closed Accounts', (m) => m.headline.closedAccounts),
  system(41, 'Funded Accounts [Active]', (m) => m.headline.fundedAccounts),
  header(42, 'Retention'),

  header(44, 'Visitors'),
  manual(45, 'visitors_web', 'New Visitors: Web', 'Web analytics', 'int'),
  manual(46, 'visitors_android', 'New Visitors: Android', 'App analytics', 'int'),
  manual(47, 'visitors_ios', 'New Visitors: iOS', 'App analytics', 'int'),
  manual(48, 'visitors_mtn_ussd', 'New Visitors: MTN - USSD', 'MTN USSD session logs', 'int'),
  manual(49, 'visitors_airtel_ussd', 'New Visitors: Airtel - USSD', 'Airtel USSD session logs', 'int'),

  header(51, 'Registered'),
  system(52, 'New Registered: Web', (m) => m.newRegisteredByChannel?.WEB ?? null),
  system(53, 'New Registered: Android', (m) => m.newRegisteredByChannel?.ANDROID ?? null),
  system(54, 'New Registered: iOS', (m) => m.newRegisteredByChannel?.IOS ?? null),
  system(55, 'New Registered: MTN - USSD', (m) => m.newRegisteredByChannel?.MTN_USSD ?? null),
  system(56, 'New Registered: Airtel - USSD', (m) => m.newRegisteredByChannel?.AIRTEL_USSD ?? null),
  formula(57, 'MTN USSD: registered per visitor', ratio(ref(55), ref(48)), 'pct'),

  header(58, 'Funded-Value'),
  ...newFundedRows(59, 'value'),
  system(67, 'Funded Again', (m) => m.fundedAgain.value, 'ugx'),
  header(69, 'Funded-Volume'),
  ...newFundedRows(70, 'volume'),
  system(78, 'Funded Again', (m) => m.fundedAgain.volume),

  header(80, 'Inflows - Value'),
  ...INFLOW_CHANNELS.slice(0, 7).map((c, i) => system(81 + i, INFLOW_LABELS[i], (m) => m.inflows.value[c], 'ugx')),
  // Total includes the "Other" channel, which has no value row of its own
  system(88, 'Total', (m) => Object.values(m.inflows.value).reduce((s, x) => s + x, 0), 'ugx'),
  header(90, 'Inflows - Volume'),
  ...INFLOW_CHANNELS.map((c, i) => system(91 + i, INFLOW_LABELS[i], (m) => m.inflows.volume[c])),

  header(100, 'Outflows - Value'),
  ...OUTFLOW_KEYS.map((c, i) => system(101 + i, OUTFLOW_LABELS[i], (m) => m.outflows.value[c], 'ugx')),
  system(104, 'Total', (m) => Object.values(m.outflows.value).reduce((s, x) => s + x, 0), 'ugx'),
  formula(105, 'Net Inflows', sumOf(ref(104), ref(88)), 'ugx'),
  header(107, 'Outflows - Volume'),
  ...OUTFLOW_KEYS.map((c, i) => system(108 + i, OUTFLOW_LABELS[i], (m) => m.outflows.volume[c])),

  header(112, 'AUM'),
  ...customerGroupRows(113, (m, g) => m.customerGroups[g].aum, 'ugx'),
  header(117, 'Funded Accounts'),
  ...customerGroupRows(118, (m, g) => m.customerGroups[g].fundedAccounts, 'int'),
  header(122, 'Inflows - Value'),
  ...customerGroupRows(123, (m, g) => m.customerGroups[g].inflowValue, 'ugx'),
  formula(126, 'Total', sumRange(123, 125), 'ugx'),
  header(127, 'Inflows - Volume'),
  ...customerGroupRows(128, (m, g) => m.customerGroups[g].inflowVolume, 'int'),
  header(132, 'Outflows - Value'),
  ...customerGroupRows(133, (m, g) => m.customerGroups[g].outflowValue, 'ugx'),
  formula(136, 'Total', sumRange(133, 135), 'ugx'),
  formula(137, 'Net Inflows', sumOf(ref(126), ref(136)), 'ugx'),
  header(139, 'Outflows - Volume'),
  ...customerGroupRows(140, (m, g) => m.customerGroups[g].outflowVolume, 'int'),

  header(144, 'Active Users'),
  ...Array.from({ length: 9 }, (_, i) =>
    system(145 + i, WEALTH_BANDS[i].label, (m) => m.wealthBands[i].activeUsers, 'int', WEALTH_BANDS[i].band)
  ),
  header(155, 'AUM'),
  ...Array.from({ length: 9 }, (_, i) => system(156 + i, WEALTH_BANDS[i].label, (m) => m.wealthBands[i].aum, 'ugx', WEALTH_BANDS[i].band)),

  header(167, 'Active Accounts'),
  ...businessLineRows(168, 'active_accounts', (m, l) => m.businessLines[l].activeAccounts, 'int'),
  header(176, 'New Active Accounts'),
  ...businessLineRows(177, 'new_active_accounts', (m, l) => m.businessLines[l].newActiveAccounts, 'int'),
  header(185, 'Churned Accounts'),
  ...businessLineRows(186, 'churned_accounts', (m, l) => m.businessLines[l].churnedAccounts, 'int'),
  header(195, 'AUM'),
  ...businessLineRows(196, 'aum', (m, l) => m.businessLines[l].aum, 'ugx'),
  header(203, 'Deposits: Value'),
  ...businessLineRows(204, 'deposit_value', (m, l) => m.businessLines[l].depositValue, 'ugx'),
  header(211, 'Withdrawals: Value'),
  ...businessLineRows(212, 'withdrawal_value', (m, l) => m.businessLines[l].withdrawalValue, 'ugx'),
  header(219, 'Deposits: Volume'),
  ...businessLineRows(220, 'deposit_volume', (m, l) => m.businessLines[l].depositVolume, 'int'),
  header(227, 'Withdrawals: Volume'),
  ...businessLineRows(228, 'withdrawal_volume', (m, l) => m.businessLines[l].withdrawalVolume, 'int'),

  header(234, 'Inflows - Share of Value'),
  ...INFLOW_LABELS.slice(0, 7).map((label, i) => formula(235 + i, label, ratio(ref(81 + i), ref(88)), 'pct')),
  formula(242, 'Other', ratio(otherInflowValue, ref(88)), 'pct'),

  header(244, 'Average Inflows - Volume'),
  ...averageRows(245, 81, 91, '', otherInflowValue),
  header(254, 'Average Inflows - Volume - New Funded'),
  ...averageRows(255, 59, 70, ''),

  header(264, 'Active'),
  system(265, 'Users', (m) => m.active.users),
  system(266, 'Accounts', (m) => m.active.accounts),
  system(267, 'Goals', (m) => m.active.goals),

  header(269, 'Autosaves - volume'),
  manual(270, 'autosaves_users', 'Users', AUTOSAVE_SOURCE, 'int'),
  manual(271, 'autosaves_accounts', 'Accounts', AUTOSAVE_SOURCE, 'int'),
  manual(272, 'autosaves_goals', 'Goals', AUTOSAVE_SOURCE, 'int'),
  header(274, 'Autosaves Channel - volume'),
  ...INFLOW_LABELS.map((label, i) => manual(275 + i, `autosave_volume_${INFLOW_CHANNELS[i].toLowerCase()}`, label, AUTOSAVE_SOURCE, 'int')),
  header(284, 'Autosaves Channel - Value'),
  ...INFLOW_LABELS.map((label, i) => manual(285 + i, `autosave_value_${INFLOW_CHANNELS[i].toLowerCase()}`, label, AUTOSAVE_SOURCE)),

  formula(294, 'Average bank inflow', ratio(ref(81), ref(91)), 'avg'),
  formula(295, 'Average mobile and web inflow', ratio(sumRange(82, 87), sumRange(92, 97)), 'avg'),
  formula(300, 'MTN inflows', sumRange(82, 84), 'ugx'),
  formula(301, 'Airtel inflows', sumRange(85, 87), 'ugx'),

  header(307, 'Average Initial Deposit - NEW'),
  ...averageRows(308, 59, 70, 'New Funded: '),
  header(319, 'Average Initial Deposit [ALL]'),
  ...averageRows(320, 81, 91, 'New Funded: ', otherInflowValue),
  header(330, 'Average Initial Deposit: NEW vs ALL'),
  ...INFLOW_LABELS.map((label, i) => formula(331 + i, `New Funded: ${label}`, ratio(ref(308 + i), ref(320 + i), -1), 'pct')),
];

export interface UgMonthColumn {
  month: string;
  periodEnd: string;
  values: Record<number, number | null>;
}

const ROW_BY_NUMBER = new Map(UG_ROWS.map((def) => [def.row, def]));

/** Every manual row by its stored key, e.g. usd_ugx -> USD/UGX (row 4). */
export const MANUAL_ROWS_BY_KEY = new Map(UG_ROWS.filter((def) => def.kind === 'manual' && def.key).map((def) => [def.key!, def]));

/**
 * Values of every non-header row for one month: system rows picked from the metrics, manual rows from
 * the hand-entered figures (blank when none), formula rows evaluated on demand (a formula may refer to
 * a formula row further down, e.g. Revenue = Total).
 */
export function buildMonthColumn(metrics: UgMonthlyMetrics, manualValues: Record<string, number> = {}): UgMonthColumn {
  const values: Record<number, number | null> = {};
  const valueOf: RowValue = (row) => {
    if (row in values) return values[row];
    const def = ROW_BY_NUMBER.get(row);
    let value: number | null = null;
    if (def?.kind === 'system' && def.pick) value = def.pick(metrics);
    if (def?.kind === 'manual' && def.key) value = manualValues[def.key] ?? null;
    if (def?.kind === 'formula' && def.expr) value = def.expr.js(valueOf);
    values[row] = value;
    return value;
  };
  for (const def of UG_ROWS) if (def.kind !== 'header') valueOf(def.row);
  return { month: metrics.month, periodEnd: metrics.periodEnd, values };
}

/** Excel formula text for a formula row in the given column letter. */
export function excelFormulaFor(def: UgRowDef, column: string): string | null {
  return def.expr ? def.expr.xl.replace(/\{c\}/g, column) : null;
}
