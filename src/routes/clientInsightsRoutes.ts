import { NextFunction, Request, Response, Router } from 'express';
import { BadRequestError } from '../errors';
import { ClientInsightsService, GenderBasis, InsightSegment } from '../services/client-insights/ClientInsightsService';
import { ImpactPackService } from '../services/client-insights/ImpactPackService';
import { GoalRiskService } from '../services/client-insights/GoalRiskService';
import { GroupSchemeService } from '../services/client-insights/GroupSchemeService';
import { writeImpactPackWorkbook } from '../services/client-insights/ImpactPackExcelExporter';

const router = Router();
const SEGMENTS: InsightSegment[] = ['INDIVIDUAL', 'INSTITUTIONAL', 'ALL'];

function readSegment(req: Request): InsightSegment {
  const segment = String(req.query.segment ?? 'INDIVIDUAL').toUpperCase() as InsightSegment;
  if (!SEGMENTS.includes(segment)) throw new BadRequestError(`segment must be one of ${SEGMENTS.join(', ')}`);
  return segment;
}

function readLimit(req: Request, fallback: number): number {
  return Math.min(Math.max(parseInt(String(req.query.limit ?? fallback), 10) || fallback, 1), 500);
}

function readGenderBasis(req: Request): GenderBasis {
  const basis = String(req.query.genderBasis ?? 'ESTIMATED').toUpperCase();
  if (basis !== 'ESTIMATED' && basis !== 'DECLARED') throw new BadRequestError('genderBasis must be ESTIMATED or DECLARED');
  return basis;
}

/**
 * GET /api/client-insights/summary?segment=INDIVIDUAL|INSTITUTIONAL|ALL&genderBasis=ESTIMATED|DECLARED
 * Headline figures and AUM composition breakdowns for funded accounts
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await ClientInsightsService.getSummary(readSegment(req), readGenderBasis(req)));
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
    res.json(await ClientInsightsService.getDataQuality(readSegment(req), readLimit(req, 50)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/risk-allocation?segment=...&limit=50
 * AUM by risk score and goal category, drift from target fund split, largest drifted goals
 */
router.get('/risk-allocation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await GoalRiskService.getRiskAllocation(readSegment(req), readLimit(req, 50)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/suitability?limit=50
 * Goals/accounts flagged by the suitability review rules (individuals)
 */
router.get('/suitability', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await GoalRiskService.getSuitabilityReview(readLimit(req, 50)));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/group-schemes
 * Member accounts rolled up by sponsor (SACCOs, clubs, schemes, family groups)
 */
router.get('/group-schemes', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await GroupSchemeService.getGroupSchemes());
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
