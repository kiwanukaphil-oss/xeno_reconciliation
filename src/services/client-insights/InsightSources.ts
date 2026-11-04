import { Prisma } from '@prisma/client';

/**
 * Where Client Insights reads its figures from: the Latest materialized views, or the stored
 * snapshot for one "as at" date. Each source is returned under the view's own name (or the alias
 * a query already uses), so queries written against the views work unchanged on a snapshot.
 */
export interface InsightSources {
  /** YYYY-MM-DD for a stored snapshot; null for Latest. */
  asOf: string | null;
  /** account_profile_aum or its snapshot, e.g. `FROM ${s.accounts('v')}`. */
  accounts: (alias?: string) => Prisma.Sql;
  /** goal_holdings or its snapshot. */
  goalHoldings: (alias?: string) => Prisma.Sql;
  /** goal_achievement or its snapshot. */
  goalAchievement: (alias?: string) => Prisma.Sql;
  /** Last transaction date counted: the as-at date, or the latest transaction date in the system. */
  transactionCutoff: Prisma.Sql;
  /** Price date used for valuations: the as-at date, or the latest price date. */
  priceCutoff: Prisma.Sql;
}

const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!AS_OF_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Builds "<view> alias" or "(snapshot rows for the date) alias" for one insight source. */
function sourceFor(view: string, snapshotTable: string, asOf: string | null) {
  return (alias: string = view): Prisma.Sql => {
    // Aliases are fixed identifiers written in the services, never user input
    const as = Prisma.raw(alias);
    if (asOf === null) return Prisma.sql`${Prisma.raw(view)} ${as}`;
    return Prisma.sql`(SELECT * FROM ${Prisma.raw(snapshotTable)} WHERE as_of_date = ${asOf}::date) ${as}`;
  };
}

/** Sources for one as-at date (validated YYYY-MM-DD), or Latest when asOf is null. */
export function insightSourcesFor(asOf: string | null): InsightSources {
  if (asOf !== null && !isIsoDate(asOf)) throw new Error(`Invalid as-at date: ${asOf}`);
  return {
    asOf,
    accounts: sourceFor('account_profile_aum', 'insights.account_snapshots', asOf),
    goalHoldings: sourceFor('goal_holdings', 'insights.goal_holding_snapshots', asOf),
    goalAchievement: sourceFor('goal_achievement', 'insights.goal_achievement_snapshots', asOf),
    transactionCutoff:
      asOf === null ? Prisma.sql`(SELECT MAX("transactionDate")::date FROM fund_transactions)` : Prisma.sql`${asOf}::date`,
    priceCutoff: asOf === null ? Prisma.sql`(SELECT MAX("priceDate")::date FROM fund_prices)` : Prisma.sql`${asOf}::date`,
  };
}

export const LATEST_SOURCES: InsightSources = insightSourcesFor(null);
