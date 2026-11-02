import { NextFunction, Request, Response, Router } from 'express';
import { BadRequestError } from '../errors';
import { ClientInsightsService, InsightSegment } from '../services/client-insights/ClientInsightsService';
import { ImpactPackService } from '../services/client-insights/ImpactPackService';
import { writeImpactPackWorkbook } from '../services/client-insights/ImpactPackExcelExporter';

const router = Router();
const SEGMENTS: InsightSegment[] = ['INDIVIDUAL', 'INSTITUTIONAL', 'ALL'];

function readSegment(req: Request): InsightSegment {
  const segment = String(req.query.segment ?? 'INDIVIDUAL').toUpperCase() as InsightSegment;
  if (!SEGMENTS.includes(segment)) throw new BadRequestError(`segment must be one of ${SEGMENTS.join(', ')}`);
  return segment;
}

/**
 * GET /api/client-insights/summary?segment=INDIVIDUAL|INSTITUTIONAL|ALL
 * Headline figures and AUM composition breakdowns for funded accounts
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await ClientInsightsService.getSummary(readSegment(req)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/data-quality?segment=...&limit=50
 * Profile completeness, flags, largest accounts missing data, unmatched districts
 */
router.get('/data-quality', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 500);
    res.json(await ClientInsightsService.getDataQuality(readSegment(req), limit));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/impact-pack
 * Impact & Inclusion data pack (investor questions on profile, usage and outcomes)
 */
router.get('/impact-pack', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await ImpactPackService.buildPack());
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/impact-pack/export
 * Same pack as an Excel workbook
 */
router.get('/impact-pack/export', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pack = await ImpactPackService.buildPack();
    const buffer = await writeImpactPackWorkbook(pack);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="xeno-impact-pack-${pack.asOf.transactions}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

export default router;
