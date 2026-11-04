import { NextFunction, Request, Response, Router } from 'express';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { ClientInsightsService, InsightSegment } from '../services/client-insights/ClientInsightsService';
import { GENDER_VIEWS, GenderView } from '../services/client-insights/GenderAllocation';
import { ImpactPackService } from '../services/client-insights/ImpactPackService';
import { GoalRiskService } from '../services/client-insights/GoalRiskService';
import { GroupSchemeService } from '../services/client-insights/GroupSchemeService';
import { GoalAchievementService } from '../services/client-insights/GoalAchievementService';
import { writeImpactPackWorkbook } from '../services/client-insights/ImpactPackExcelExporter';
import { InsightSnapshotService } from '../services/client-insights/InsightSnapshotService';
import { InsightSources } from '../services/client-insights/InsightSources';
import {
  AccountDirectoryFilters,
  AccountDirectoryService,
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

/**
 * Resolves the optional ?asOf=YYYY-MM-DD (omitted or "latest" = Latest). When that date's snapshot is
 * ready the handler runs against it; otherwise a build is started and 202 is returned with its status,
 * so the page can show "preparing" and poll GET /snapshots/:asOf.
 */
async function respondAsOf(req: Request, res: Response, produce: (sources: InsightSources) => Promise<unknown>): Promise<void> {
  const resolution = await InsightSnapshotService.resolveAsOf(req.query.asOf);
  if (!resolution.ready) {
    res.status(202).json({ preparing: true, snapshot: resolution.snapshot });
    return;
  }
  res.json(await produce(resolution.sources));
}

/** Like respondAsOf for file downloads, which cannot wait: a snapshot that is not ready is a 409. */
async function readyAsOfSources(req: Request): Promise<InsightSources> {
  const resolution = await InsightSnapshotService.resolveAsOf(req.query.asOf);
  if (!resolution.ready) {
    throw new ConflictError(`Figures as at ${resolution.snapshot.asOf} are still being prepared; try again in a minute`);
  }
  return resolution.sources;
}

/** ?genderView=IDENTIFIED (declared gender only, the default) or ALLOCATED (unidentified split in the known ratio). */
function readGenderView(req: Request): GenderView {
  const view = String(req.query.genderView ?? 'IDENTIFIED').toUpperCase() as GenderView;
  if (!GENDER_VIEWS.includes(view)) throw new BadRequestError(`genderView must be one of ${GENDER_VIEWS.join(', ')}`);
  return view;
}

/**
 * GET /api/client-insights/summary?segment=INDIVIDUAL|INSTITUTIONAL|ALL&genderView=IDENTIFIED|ALLOCATED
 * Headline figures and AUM composition breakdowns for funded accounts
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await respondAsOf(req, res, (sources) => ClientInsightsService.getSummary(readSegment(req), readGenderView(req), sources));
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
    await respondAsOf(req, res, (sources) => ClientInsightsService.getDataQuality(readSegment(req), readLimit(req, 50), sources));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/risk-allocation?segment=...&limit=50&genderView=IDENTIFIED|ALLOCATED
 * AUM by risk score and goal category (each with a female/male split), drift from target fund split, largest drifted goals
 */
router.get('/risk-allocation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await respondAsOf(req, res, (sources) =>
      GoalRiskService.getRiskAllocation(readSegment(req), readLimit(req, 50), readGenderView(req), sources)
    );
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
    await respondAsOf(req, res, (sources) => GoalRiskService.getSuitabilityReview(readLimit(req, 50), sources));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/group-schemes
 * Member accounts rolled up by sponsor (SACCOs, clubs, schemes, family groups)
 */
router.get('/group-schemes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await respondAsOf(req, res, (sources) => GroupSchemeService.getGroupSchemes(sources));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/goal-achievement?segment=INDIVIDUAL|INSTITUTIONAL|ALL&genderView=IDENTIFIED|ALLOCATED
 * Goal target achievement: reached and holding, reached and used, progress, pace and breakdowns (with female/male splits)
 */
router.get('/goal-achievement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await respondAsOf(req, res, (sources) => GoalAchievementService.getReport(readSegment(req), readGenderView(req), sources));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/impact-pack
 * Impact & Inclusion data pack (investor questions on profile, usage and outcomes)
 */
router.get('/impact-pack', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await respondAsOf(req, res, (sources) => ImpactPackService.buildPack(sources));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/impact-pack/export
 * Same pack as an Excel workbook
 */
router.get('/impact-pack/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pack = await ImpactPackService.buildPack(await readyAsOfSources(req));
    const buffer = await writeImpactPackWorkbook(pack);
    const fileDate = pack.asOf.snapshot ? `as-at-${pack.asOf.snapshot}` : pack.asOf.transactions;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="xeno-impact-pack-${fileDate}.xlsx"`);
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
 * field, minimum balance and a search term (name, or account number prefix).
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
    missing: readChoice(req, 'missing', DIRECTORY_MISSING),
    minBalance,
  };
}

/**
 * GET /api/client-insights/accounts?search=&segment=&funded=&channel=&gender=&missing=&minBalance=
 *     &sort=balance|name|lastDeposit|accountNumber&direction=asc|desc&page=1&pageSize=50
 * Paged account directory with Ultima profile fields and what is missing
 */
router.get('/accounts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sort = (DIRECTORY_SORTS.find((s) => s === req.query.sort) ?? 'balance') as DirectorySort;
    const direction = String(req.query.direction ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
    const pageSize = Math.min(parseInt(String(req.query.pageSize ?? '50'), 10) || 50, MAX_PAGE_SIZE);
    const filters = readDirectoryFilters(req);
    await respondAsOf(req, res, (sources) => AccountDirectoryService.listAccounts(filters, { page, pageSize, sort, direction }, sources));
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
  let sources: InsightSources;
  try {
    filters = readDirectoryFilters(req);
    sources = await readyAsOfSources(req);
  } catch (error) {
    return next(error);
  }
  let cancelled = false;
  res.on('close', () => {
    if (!res.writableFinished) cancelled = true;
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const fileDate = sources.asOf ? `as-at-${sources.asOf}` : new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="xeno-account-profiles-${fileDate}.xlsx"`);
  try {
    await AccountDirectoryService.streamAccountsWorkbook(filters, res, () => cancelled, sources);
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
    await respondAsOf(req, res, async (sources) => {
      const detail = await AccountDirectoryService.getAccountDetail(req.params.accountNumber, sources);
      if (!detail) throw new NotFoundError('Account', req.params.accountNumber);
      return detail;
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/as-of-dates
 * Dates the as-at selector offers (month-ends and any stored date) with each one's build status
 */
router.get('/as-of-dates', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await InsightSnapshotService.listDates());
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/client-insights/snapshots/build-period-ends
 * Builds every month-end snapshot that is not ready, one at a time in the background
 */
router.post('/snapshots/build-period-ends', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { dates } = await InsightSnapshotService.listDates();
    const pending = dates.filter((d) => d.isPeriodEnd && d.status !== 'READY').map((d) => d.asOf);
    void InsightSnapshotService.buildMissingPeriodEnds();
    res.status(202).json({ started: true, dates: pending });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/client-insights/snapshots/:asOf
 * Build status of one as-at date (NOT_BUILT, BUILDING, READY, STALE or FAILED)
 */
router.get('/snapshots/:asOf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await InsightSnapshotService.assertReportableDate(req.params.asOf);
    res.json(await InsightSnapshotService.getSnapshot(req.params.asOf));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/client-insights/snapshots/:asOf
 * Prepares one as-at date in the background (no-op if it is already ready)
 */
router.post('/snapshots/:asOf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await InsightSnapshotService.assertReportableDate(req.params.asOf);
    const snapshot = await InsightSnapshotService.requestBuild(req.params.asOf);
    res.status(snapshot.status === 'READY' ? 200 : 202).json(snapshot);
  } catch (error) {
    next(error);
  }
});

export default router;
