import { NextFunction, Request, Response, Router } from 'express';
import { BadRequestError, NotFoundError } from '../errors';
import { ClientInsightsService, GenderBasis, InsightSegment } from '../services/client-insights/ClientInsightsService';
import { ImpactPackService } from '../services/client-insights/ImpactPackService';
import { GoalRiskService } from '../services/client-insights/GoalRiskService';
import { GroupSchemeService } from '../services/client-insights/GroupSchemeService';
import { GoalAchievementService } from '../services/client-insights/GoalAchievementService';
import { writeImpactPackWorkbook } from '../services/client-insights/ImpactPackExcelExporter';
import {
  AccountDirectoryFilters,
  AccountDirectoryService,
  DirectoryEstimateFilter,
  DirectoryFundedFilter,
  DirectoryMissingFilter,
  DirectorySort,
  MAX_PAGE_SIZE,
} from '../services/client-insights/AccountDirectoryService';

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
 * GET /api/client-insights/goal-achievement?segment=INDIVIDUAL|INSTITUTIONAL|ALL
 * Goal target achievement: reached and holding, reached and used, progress, pace and breakdowns
 */
router.get('/goal-achievement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await GoalAchievementService.getReport(readSegment(req)));
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

const DIRECTORY_SORTS: DirectorySort[] = ['balance', 'name', 'lastDeposit', 'accountNumber'];
const DIRECTORY_MISSING: DirectoryMissingFilter[] = ['ANY', 'GENDER', 'DATE_OF_BIRTH', 'LOCATION', 'NO_PROFILE'];
const DIRECTORY_FUNDED: DirectoryFundedFilter[] = ['FUNDED', 'UNFUNDED', 'ALL'];
const DIRECTORY_CHANNELS = ['MTN', 'WEB', 'APP', 'YOLLO', 'UNKNOWN'];
const DIRECTORY_GENDERS = ['FEMALE', 'MALE', 'UNDISCLOSED', 'UNKNOWN'];
const DIRECTORY_ESTIMATES: DirectoryEstimateFilter[] = ['ESTIMATED', 'LOW_CONFIDENCE', 'NOT_ESTIMABLE'];
const MAX_SEARCH_LENGTH = 100;

/** Reads one optional enum query parameter, rejecting values outside the allowed list. */
function readChoice<T extends string>(req: Request, name: string, allowed: readonly T[]): T | undefined {
  const raw = req.query[name];
  if (raw === undefined || raw === '') return undefined;
  const value = String(raw).toUpperCase() as T;
  const match = allowed.find((a) => a.toUpperCase() === value);
  if (!match) throw new BadRequestError(`${name} must be one of ${allowed.join(', ')}`);
  return match;
}

/**
 * Reads and validates the Account Profiles filters shared by the list and the
 * export: segment, funded status, sign-up channel, declared gender, missing
 * field, gender estimate status, minimum balance and a search term (name, or account number prefix).
 */
function readDirectoryFilters(req: Request): AccountDirectoryFilters {
  const search = req.query.search === undefined ? undefined : String(req.query.search).trim();
  if (search && search.length > MAX_SEARCH_LENGTH) throw new BadRequestError(`search must be at most ${MAX_SEARCH_LENGTH} characters`);
  const minBalanceRaw = req.query.minBalance;
  const minBalance = minBalanceRaw === undefined || minBalanceRaw === '' ? undefined : Number(minBalanceRaw);
  if (minBalance !== undefined && !Number.isFinite(minBalance)) throw new BadRequestError('minBalance must be a number');
  return {
    search: search || undefined,
    segment: String(req.query.segment ?? 'ALL').toUpperCase() === 'ALL' ? 'ALL' : readSegment(req),
    funded: readChoice(req, 'funded', DIRECTORY_FUNDED) ?? 'FUNDED',
    channel: readChoice(req, 'channel', DIRECTORY_CHANNELS),
    gender: readChoice(req, 'gender', DIRECTORY_GENDERS),
    genderEstimate: readChoice(req, 'genderEstimate', DIRECTORY_ESTIMATES),
    missing: readChoice(req, 'missing', DIRECTORY_MISSING),
    minBalance,
  };
}

/**
 * GET /api/client-insights/accounts?search=&segment=&funded=&channel=&gender=&genderEstimate=&missing=&minBalance=
 *     &sort=balance|name|lastDeposit|accountNumber&direction=asc|desc&page=1&pageSize=50
 * Paged account directory with Ultima profile fields and what is missing
 */
router.get('/accounts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sort = (DIRECTORY_SORTS.find((s) => s === req.query.sort) ?? 'balance') as DirectorySort;
    const direction = String(req.query.direction ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = Math.min(parseInt(String(req.query.pageSize ?? '50'), 10) || 50, MAX_PAGE_SIZE);
    res.json(await AccountDirectoryService.listAccounts(readDirectoryFilters(req), { page, pageSize, sort, direction }));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/accounts/export?<same filters>
 * Every matching account as a streamed Excel workbook (largest balance first)
 */
router.get('/accounts/export', async (req: Request, res: Response, next: NextFunction) => {
  let filters: AccountDirectoryFilters;
  try {
    filters = readDirectoryFilters(req);
  } catch (error) {
    return next(error);
  }
  let cancelled = false;
  res.on('close', () => {
    if (!res.writableFinished) cancelled = true;
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="xeno-account-profiles-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  try {
    await AccountDirectoryService.streamAccountsWorkbook(filters, res, () => cancelled);
  } catch (error) {
    // Headers are already sent once streaming starts, so the response can only be cut short
    if (!res.headersSent) return next(error);
    res.destroy(error as Error);
  }
});

/**
 * GET /api/client-insights/accounts/:accountNumber
 * One account's profile, activity and goals
 */
router.get('/accounts/:accountNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await AccountDirectoryService.getAccountDetail(req.params.accountNumber);
    if (!detail) throw new NotFoundError('Account', req.params.accountNumber);
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

export default router;
