import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { BadRequestError } from '../../errors';
import { MANUAL_ROWS_BY_KEY } from './UgMetricsLayout';

export interface UgManualInputsForMonth {
  month: string; // YYYY-MM
  values: Record<string, number>;
  updatedAt: string | null;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
// Keys whose figures can only be positive (a rate or a count); money rows may be negative (e.g. a loss)
const POSITIVE_ONLY_FORMATS = new Set(['rate', 'int']);

/**
 * Hand-entered Inputs-UG figures the system has no source for (USD/UGX, financials, bank balances,
 * visitors, autosaves), stored per month and metric key. Saving a month replaces exactly the keys
 * sent: a number sets the figure, null clears it, keys not sent are left as they are.
 */
export class UgManualInputService {
  /** Stored figures for each month (YYYY-MM); months with nothing entered come back with empty values. */
  static async getForMonths(months: string[]): Promise<Map<string, UgManualInputsForMonth>> {
    const result = new Map<string, UgManualInputsForMonth>(months.map((m) => [m, { month: m, values: {}, updatedAt: null }]));
    if (months.length === 0) return result;
    const rows = await prisma.$queryRaw<Array<{ month: string; metric_key: string; value: number; updated_at: Date }>>`
      SELECT to_char(month, 'YYYY-MM') AS month, "metricKey" AS metric_key, value::float8 AS value, "updatedAt" AS updated_at
      FROM ug_metric_manual_inputs
      WHERE month IN (${Prisma.join(months.map((m) => Prisma.sql`${`${m}-01`}::date`))})`;
    for (const row of rows) {
      const entry = result.get(row.month);
      if (!entry || !MANUAL_ROWS_BY_KEY.has(row.metric_key)) continue;
      entry.values[row.metric_key] = row.value;
      const at = row.updated_at.toISOString();
      if (!entry.updatedAt || at > entry.updatedAt) entry.updatedAt = at;
    }
    return result;
  }

  /**
   * Validates and saves one month's figures in a transaction: unknown keys, non-numbers and negative
   * counts or rates are rejected before anything is written. Returns the month's figures after saving.
   */
  static async saveMonth(month: string, changes: Record<string, unknown>): Promise<UgManualInputsForMonth> {
    if (!MONTH_PATTERN.test(month)) throw new BadRequestError('month must be in YYYY-MM format');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new BadRequestError('values must be an object of metric key -> number or null');

    const toSet: Array<{ key: string; value: number }> = [];
    const toClear: string[] = [];
    for (const [key, raw] of Object.entries(changes)) {
      const def = MANUAL_ROWS_BY_KEY.get(key);
      if (!def) throw new BadRequestError(`Unknown manual metric "${key}"`);
      if (raw === null || raw === '') {
        toClear.push(key);
        continue;
      }
      const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(value)) throw new BadRequestError(`${def.label} (row ${def.row}) must be a number`);
      if (POSITIVE_ONLY_FORMATS.has(def.format ?? '') && value < 0) throw new BadRequestError(`${def.label} (row ${def.row}) cannot be negative`);
      toSet.push({ key, value });
    }

    const monthStart = `${month}-01`;
    await prisma.$transaction([
      ...(toClear.length
        ? [prisma.$executeRaw`
            DELETE FROM ug_metric_manual_inputs
            WHERE month = ${monthStart}::date AND "metricKey" IN (${Prisma.join(toClear)})`]
        : []),
      ...toSet.map(({ key, value }) => prisma.$executeRaw`
        INSERT INTO ug_metric_manual_inputs (month, "metricKey", value, "updatedAt")
        VALUES (${monthStart}::date, ${key}, ${value}, now())
        ON CONFLICT (month, "metricKey") DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`),
    ]);
    return (await this.getForMonths([month])).get(month)!;
  }
}
