import { NextFunction, Request, Response, Router } from 'express';
import { BadRequestError, ConflictError } from '../errors';
import { buildMonthColumn, UG_ROWS } from '../services/reporting/UgMetricsLayout';
import { writeUgMetricsWorkbook } from '../services/reporting/UgMetricsExcelExporter';
import { UgManualInputService } from '../services/reporting/UgManualInputService';
import { UG_METRIC_DEFINITIONS, UgMonthlyMetricsService } from '../services/reporting/UgMonthlyMetricsService';

const router = Router();

/** Reads ?from=YYYY-MM&to=YYYY-MM (to defaults to from). */
function readMonthRange(req: Request): { from: string; to: string } {
  const from = String(req.query.from ?? '');
  if (!from) throw new BadRequestError('from (YYYY-MM) is required');
  return { from, to: String(req.query.to ?? from) };
}

/**
 * GET /api/reports/ug-metrics?month=YYYY-MM
 * Inputs-UG figures of the monthly XENO_Metrics report for one month, as structured metrics. When the
 * month-end snapshots are still being prepared, returns 202 with their statuses so the caller can poll.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await UgMonthlyMetricsService.getMonth(String(req.query.month ?? ''));
    if (!result.ready) {
      res.status(202).json({ preparing: true, snapshots: result.snapshots });
      return;
    }
    res.json(result.metrics);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/reports/ug-metrics/rows?from=YYYY-MM&to=YYYY-MM
 * The Inputs-UG sheet as rows (row number, label, kind, format, source) with one value per month,
 * for the report page. 202 while month-end snapshots are being prepared.
 */
router.get('/rows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = readMonthRange(req);
    const result = await UgMonthlyMetricsService.getMonths(from, to);
    if (!result.ready) {
      res.status(202).json({ preparing: true, snapshots: result.snapshots });
      return;
    }
    const manual = await UgManualInputService.getForMonths(result.months.map((m) => m.month));
    const columns = result.months.map((m) => buildMonthColumn(m, manual.get(m.month)?.values));
    res.json({
      months: result.months.map((m) => ({
        month: m.month,
        periodEnd: m.periodEnd,
        priceAsOf: m.priceAsOf,
        manualUpdatedAt: manual.get(m.month)?.updatedAt ?? null,
      })),
      rows: UG_ROWS.map((def) => ({
        row: def.row,
        band: def.band ?? null,
        label: def.label,
        key: def.key ?? null,
        kind: def.kind,
        format: def.format ?? null,
        source: def.source ?? null,
        values: def.kind === 'header' ? [] : columns.map((c) => c.values[def.row] ?? null),
      })),
      definitions: UG_METRIC_DEFINITIONS,
      notComputed: result.months[0].notComputed,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/reports/ug-metrics/export?from=YYYY-MM&to=YYYY-MM
 * Excel workbook in the Inputs-UG layout. A download cannot wait, so months still being prepared are a 409.
 */
router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = readMonthRange(req);
    const result = await UgMonthlyMetricsService.getMonths(from, to);
    if (!result.ready) {
      const dates = result.snapshots.map((s) => s.asOf).join(', ');
      throw new ConflictError(`Month-end figures for ${dates} are still being prepared; try again in a minute`);
    }
    const manual = await UgManualInputService.getForMonths(result.months.map((m) => m.month));
    const buffer = await writeUgMetricsWorkbook(result.months, manual);
    const fileName = from === to ? `xeno-metrics-inputs-ug-${from}.xlsx` : `xeno-metrics-inputs-ug-${from}-to-${to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/reports/ug-metrics/manual-inputs/:month   body: { values: { usd_ugx: 3915, spend: null, ... } }
 * Saves hand-entered figures for one month (YYYY-MM): a number sets a figure, null clears it, keys not
 * sent are unchanged. Returns the month's stored figures.
 */
router.put('/manual-inputs/:month', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await UgManualInputService.saveMonth(req.params.month, req.body?.values));
  } catch (error) {
    next(error);
  }
});

export default router;
