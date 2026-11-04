import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { BadRequestError } from '../../errors';
import { InsightSources, insightSourcesFor, isIsoDate, LATEST_SOURCES } from './InsightSources';

export type SnapshotStatus = 'NOT_BUILT' | 'BUILDING' | 'READY' | 'STALE' | 'FAILED';

export interface SnapshotDateInfo {
  asOf: string;
  status: SnapshotStatus;
  isPeriodEnd: boolean;
  builtAt: string | null;
  buildMs: number | null;
  accountRows: number | null;
  priceAsOf: string | null;
  error: string | null;
}

/** Result of resolving a request's as-at date: figures can be served, or the snapshot is being prepared. */
export type AsOfResolution =
  | { ready: true; sources: InsightSources }
  | { ready: false; snapshot: SnapshotDateInfo };

// Month-ends offered for reporting start here (earlier dates can still be picked individually)
const FIRST_PERIOD_END = '2025-01-31';
// A build still marked BUILDING after this long is assumed to have died with its process
const ABANDONED_BUILD_MS = 15 * 60 * 1000;
// One build can scan every transaction several times
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
// Background rebuilds wait for uploads to go quiet, so a run of batches triggers one rebuild
const REBUILD_QUIET_MS = 5 * 60 * 1000;

let rebuildTimer: NodeJS.Timeout | null = null;
let rebuildRunning = false;

/**
 * Stored "as at" snapshots for Client Insights: which dates exist, building them on request,
 * marking them stale when backdated data arrives, and rebuilding stale month-ends in the background.
 * Builds take about 40 seconds and run outside the request; a transaction-level advisory lock per
 * date stops the API and the worker building the same date twice.
 */
export class InsightSnapshotService {
  /**
   * Validates a request's asOf value and says whether its figures can be served now. No value
   * means Latest. A missing, stale, failed or abandoned snapshot is (re)built in the background and
   * reported as not ready, so the caller can show "preparing" and poll.
   */
  static async resolveAsOf(asOfRaw: unknown): Promise<AsOfResolution> {
    if (asOfRaw === undefined || asOfRaw === '' || String(asOfRaw).toLowerCase() === 'latest') {
      return { ready: true, sources: LATEST_SOURCES };
    }
    const asOf = String(asOfRaw);
    await this.assertReportableDate(asOf);
    const snapshot = await this.getSnapshot(asOf);
    if (snapshot.status === 'READY') return { ready: true, sources: insightSourcesFor(asOf) };
    return { ready: false, snapshot: await this.requestBuild(asOf) };
  }

  /** Rejects dates that are not YYYY-MM-DD, before the first transaction, or after the latest one. */
  static async assertReportableDate(asOf: string): Promise<void> {
    if (!isIsoDate(asOf)) throw new BadRequestError('asOf must be a date in YYYY-MM-DD format, or "latest"');
    const range = await this.getDataRange();
    if (asOf < range.firstTransaction) throw new BadRequestError(`No transactions before ${range.firstTransaction}`);
    if (asOf > range.latestTransaction) {
      throw new BadRequestError(`Transactions run to ${range.latestTransaction}; choose that date or earlier, or Latest`);
    }
  }

  static async getDataRange(): Promise<{ firstTransaction: string; latestTransaction: string; latestPrice: string | null }> {
    const [r] = await prisma.$queryRaw<any[]>`
      SELECT MIN("transactionDate")::date::text AS first_tx, MAX("transactionDate")::date::text AS last_tx,
             (SELECT MAX("priceDate")::date::text FROM fund_prices) AS last_price
      FROM fund_transactions`;
    return { firstTransaction: r.first_tx, latestTransaction: r.last_tx, latestPrice: r.last_price };
  }

  /**
   * Dates the date selector offers: every month-end from FIRST_PERIOD_END up to the latest
   * transaction date, plus any other date already stored, each with its build status.
   */
  static async listDates(): Promise<{ latest: { transactions: string; prices: string | null }; dates: SnapshotDateInfo[] }> {
    const range = await this.getDataRange();
    const stored = new Map((await this.readRegistry()).map((s) => [s.asOf, s]));
    const dates = new Map<string, SnapshotDateInfo>();
    for (const monthEnd of monthEndsBetween(FIRST_PERIOD_END, range.latestTransaction)) {
      dates.set(monthEnd, { ...(stored.get(monthEnd) ?? notBuilt(monthEnd)), isPeriodEnd: true });
    }
    for (const [asOf, info] of stored) if (!dates.has(asOf)) dates.set(asOf, info);
    return {
      latest: { transactions: range.latestTransaction, prices: range.latestPrice },
      dates: [...dates.values()].sort((a, b) => b.asOf.localeCompare(a.asOf)),
    };
  }

  static async getSnapshot(asOf: string): Promise<SnapshotDateInfo> {
    const [row] = await this.readRegistry(asOf);
    return row ?? notBuilt(asOf);
  }

  /**
   * Starts a background build unless one is already running for the date (and not abandoned).
   * Returns the status to report straight away: READY if nothing needs doing, otherwise BUILDING.
   */
  static async requestBuild(asOf: string, isPeriodEnd = false): Promise<SnapshotDateInfo> {
    const current = await this.getSnapshot(asOf);
    if (current.status === 'READY') return current;
    const [row] = await prisma.$queryRaw<any[]>`
      SELECT requested_at FROM insights.snapshot_dates WHERE as_of_date = ${asOf}::date`;
    const buildingRecently =
      current.status === 'BUILDING' && row && Date.now() - new Date(row.requested_at).getTime() < ABANDONED_BUILD_MS;
    if (!buildingRecently) {
      await prisma.$executeRaw`
        INSERT INTO insights.snapshot_dates (as_of_date, status, is_period_end, requested_at)
        VALUES (${asOf}::date, 'BUILDING', ${isPeriodEnd || isMonthEnd(asOf)}, now())
        ON CONFLICT (as_of_date) DO UPDATE SET status = 'BUILDING', requested_at = now(), error = NULL`;
      void this.buildSnapshot(asOf, isPeriodEnd || isMonthEnd(asOf));
    }
    return this.getSnapshot(asOf);
  }

  /**
   * Builds one date inside a transaction holding an advisory lock for that date, so a parallel
   * request (API or worker) skips instead of duplicating the work. Failures are recorded as FAILED.
   */
  static async buildSnapshot(asOf: string, isPeriodEnd: boolean): Promise<void> {
    const started = Date.now();
    try {
      const built = await prisma.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<any[]>`SELECT pg_try_advisory_xact_lock(hashtext(${'insight-snapshot:' + asOf})) AS got`;
          if (!lock.got) return false;
          await tx.$queryRaw`SELECT as_of_date FROM insights.build_snapshot(${asOf}::date, ${isPeriodEnd})`;
          return true;
        },
        { timeout: BUILD_TIMEOUT_MS, maxWait: 10000 }
      );
      if (built) logger.info(`Insight snapshot ${asOf} built in ${Date.now() - started}ms`);
    } catch (error: any) {
      logger.error(`Insight snapshot ${asOf} failed: ${error.message}`);
      await prisma.$executeRaw`
        UPDATE insights.snapshot_dates SET status = 'FAILED', error = ${String(error.message).slice(0, 1000)}
        WHERE as_of_date = ${asOf}::date`;
    }
  }

  /**
   * Marks snapshots dated on or after fromDate as stale (all snapshots when fromDate is null), then
   * schedules a background rebuild of stale month-ends. Call after transactions, prices or profiles change.
   * Short-lived scripts pass scheduleRebuild: false; stale dates then rebuild when next opened or uploaded.
   */
  static async markStaleFrom(fromDate: string | null, reason: string, options: { scheduleRebuild?: boolean } = {}): Promise<void> {
    const updated = await prisma.$executeRaw`
      UPDATE insights.snapshot_dates SET status = CASE WHEN status = 'BUILDING' THEN status ELSE 'STALE' END,
             stale_since = now()
      ${fromDate === null ? Prisma.empty : Prisma.sql`WHERE as_of_date >= ${fromDate}::date`}`;
    if (updated > 0) {
      logger.info(`Marked ${updated} insight snapshots stale from ${fromDate ?? 'the start'} (${reason})`);
      if (options.scheduleRebuild !== false) this.scheduleStaleRebuild();
    }
  }

  /** Debounced: rebuilds stale month-ends once changes have been quiet for REBUILD_QUIET_MS. */
  static scheduleStaleRebuild(): void {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      void this.rebuildStalePeriodEnds();
    }, REBUILD_QUIET_MS);
  }

  /**
   * Rebuilds stale or failed month-end snapshots one at a time, newest first. Other dates stay stale
   * until someone opens them, which rebuilds them on request.
   */
  static async rebuildStalePeriodEnds(): Promise<number> {
    if (rebuildRunning) return 0;
    rebuildRunning = true;
    let rebuilt = 0;
    try {
      const stale = await prisma.$queryRaw<any[]>`
        SELECT as_of_date::text AS as_of FROM insights.snapshot_dates
        WHERE is_period_end AND status IN ('STALE', 'FAILED') ORDER BY as_of_date DESC`;
      for (const { as_of } of stale) {
        await prisma.$executeRaw`UPDATE insights.snapshot_dates SET status = 'BUILDING', requested_at = now() WHERE as_of_date = ${as_of}::date`;
        await this.buildSnapshot(as_of, true);
        rebuilt++;
      }
    } finally {
      rebuildRunning = false;
    }
    return rebuilt;
  }

  /**
   * Builds every month-end from FIRST_PERIOD_END to the latest transaction that is not READY,
   * one at a time (used to prepare the reporting calendar). Returns the dates built.
   */
  static async buildMissingPeriodEnds(): Promise<string[]> {
    const { dates } = await this.listDates();
    const todo = dates.filter((d) => d.isPeriodEnd && d.status !== 'READY').map((d) => d.asOf);
    for (const asOf of todo) {
      await prisma.$executeRaw`
        INSERT INTO insights.snapshot_dates (as_of_date, status, is_period_end, requested_at)
        VALUES (${asOf}::date, 'BUILDING', true, now())
        ON CONFLICT (as_of_date) DO UPDATE SET status = 'BUILDING', requested_at = now(), error = NULL`;
      await this.buildSnapshot(asOf, true);
    }
    return todo;
  }

  private static async readRegistry(asOf?: string): Promise<SnapshotDateInfo[]> {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT as_of_date::text AS as_of, status, is_period_end, built_at::text AS built_at, build_ms,
             account_rows, price_as_of::text AS price_as_of, error
      FROM insights.snapshot_dates
      ${asOf === undefined ? Prisma.empty : Prisma.sql`WHERE as_of_date = ${asOf}::date`}
      ORDER BY as_of_date DESC`;
    return rows.map((r) => ({
      asOf: r.as_of,
      status: r.status,
      isPeriodEnd: r.is_period_end,
      builtAt: r.built_at,
      buildMs: r.build_ms,
      accountRows: r.account_rows,
      priceAsOf: r.price_as_of,
      error: r.error,
    }));
  }
}

function notBuilt(asOf: string): SnapshotDateInfo {
  return { asOf, status: 'NOT_BUILT', isPeriodEnd: isMonthEnd(asOf), builtAt: null, buildMs: null, accountRows: null, priceAsOf: null, error: null };
}

function isMonthEnd(asOf: string): boolean {
  const next = new Date(`${asOf}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}

/** Last day of every month from the month of `from` through `to` (inclusive, YYYY-MM-DD). */
function monthEndsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
  for (;;) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (monthEnd > to) break;
    result.push(monthEnd);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
