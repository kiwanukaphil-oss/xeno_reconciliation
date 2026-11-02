import path from 'path';
import { GoalType, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { readUltimaExportRows, UltimaRow } from './UltimaExportReader';
import {
  cleanOptionalText,
  derivePhoneNetwork,
  normaliseGender,
  parseDateOfBirth,
  parseExportDate,
  parseSignupSource,
  regionForDistrict,
  resolveLocation,
} from './ProfileFieldNormalizer';
import { UGANDA_DISTRICTS_BY_REGION } from './ugandaDistricts';

const WRITE_BATCH_SIZE = 1000;

// Ultima goal categories that correspond directly to an existing GoalType value
const GOAL_TYPE_BY_ULTIMA_NAME: Record<string, GoalType> = {
  WEALTH: GoalType.WEALTH,
  EMERGENCIES: GoalType.EMERGENCY,
  RETIREMENT: GoalType.RETIREMENT,
  EDUCATION: GoalType.EDUCATION,
};

type ProfileDraft = Omit<Prisma.AccountProfileCreateManyInput, 'districtId'> & { districtName: string | null };
type GoalSnapshotDraft = Prisma.UltimaGoalSnapshotCreateManyInput & { asOfDate: Date; goalTarget: number | null };

interface GoalEnrichment {
  goalNumber: string;
  riskScore: number | null;
  ultimaGoalName: string | null;
  sponsorTitle: string | null;
  ultimaEnabled: boolean | null;
  mappedGoalType: GoalType | null;
}

export interface ClientProfileImportReport {
  dryRun: boolean;
  files: string[];
  rowsRead: { clientAccounts: number; goalData: number; goalStats: number; skippedOtherSheets: number };
  accounts: {
    inSystem: number;
    profiled: number;
    withoutProfile: number;
    exportRowsNotInSystem: number;
    duplicateExportRows: number;
  };
  goals: {
    inSystem: number;
    enriched: number;
    goalTypeFilledFromOther: number;
    ultimaSnapshots: number;
    snapshotAsOfDates: string[];
    targetsFromUltima: number;
  };
  distributions: Record<string, Record<string, number>>;
  unmatchedDistrictValues: Array<{ value: string; accounts: number }>;
}

/**
 * Enriches accounts and goals that already exist in the system with data from
 * Ultima client exports. Export rows for accounts/goals not in the system are
 * ignored, and nothing is ever created in clients/accounts/goals.
 *
 * Only derived, report-ready fields are stored: names, phone numbers, emails,
 * street addresses and bank details from the export are read but discarded.
 * Re-running is safe: each run replaces the profiles of the accounts it covers
 * and the Ultima goal snapshots for the as-of dates it covers.
 *
 * Goal Stats exports are stamped with an as-of date taken from the file name
 * ("... 2026-11-02 08_45_59 ...") unless options.asOfDate overrides it.
 */
export class ClientProfileImporter {
  static async importFromFiles(
    filePaths: string[],
    options: { dryRun: boolean; asOfDate?: Date }
  ): Promise<ClientProfileImportReport> {
    const accountIdByNumber = new Map(
      (await prisma.account.findMany({ select: { id: true, accountNumber: true } })).map((a) => [a.accountNumber, a.id])
    );
    const systemGoals = await prisma.goal.findMany({ select: { id: true, goalNumber: true, goalType: true } });
    const goalTypeByNumber = new Map(systemGoals.map((g) => [g.goalNumber, g.goalType]));
    const goalIdByNumber = new Map(systemGoals.map((g) => [g.goalNumber, g.id]));

    const profiles = new Map<string, ProfileDraft>();
    const goals = new Map<string, GoalEnrichment>();
    const snapshots = new Map<string, GoalSnapshotDraft>();
    const report = createEmptyReport(filePaths, options.dryRun, accountIdByNumber.size, goalTypeByNumber.size);
    const unmatchedDistricts = new Map<string, number>();

    for (const filePath of [...filePaths].sort()) {
      logger.info(`Reading Ultima export: ${path.basename(filePath)}`);
      let snapshotAsOf: Date | undefined;
      for await (const { sheet, row } of readUltimaExportRows(filePath)) {
        if (sheet === 'CLIENT_ACCOUNTS') {
          report.rowsRead.clientAccounts++;
          collectAccountProfile(row, filePath, accountIdByNumber, profiles, report, unmatchedDistricts);
        } else if (sheet === 'GOAL_DATA') {
          report.rowsRead.goalData++;
          collectGoalEnrichment(row, goalTypeByNumber, goals);
        } else if (sheet === 'GOAL_STATS') {
          report.rowsRead.goalStats++;
          snapshotAsOf ??= options.asOfDate ?? asOfDateFromFileName(filePath);
          collectGoalSnapshot(row, filePath, snapshotAsOf, goalIdByNumber, snapshots);
        } else {
          report.rowsRead.skippedOtherSheets++;
        }
      }
    }

    summariseCollectedData(report, profiles, goals, goalTypeByNumber, unmatchedDistricts);
    summariseGoalSnapshots(report, snapshots);
    if (!options.dryRun) {
      const districtIdByName = await ensureDistrictReferenceData();
      await writeAccountProfiles([...profiles.values()], districtIdByName);
      await writeGoalEnrichment([...goals.values()]);
      await writeGoalSnapshots([...snapshots.values()]);
      await writeGoalTargetsFromLatestSnapshot([...snapshots.values()]);
    }
    return report;
  }
}

/** Reads the export timestamp Ultima puts in file names, e.g. "Export -2026-11-02 08_45_59 (3).xlsx". */
function asOfDateFromFileName(filePath: string): Date {
  const match = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})[ _]\d{2}_\d{2}_\d{2}/);
  if (!match) {
    throw new Error(`Cannot tell the as-of date of ${path.basename(filePath)}; pass --as-of=YYYY-MM-DD`);
  }
  return new Date(`${match[1]}T00:00:00.000Z`);
}

function createEmptyReport(files: string[], dryRun: boolean, accountsInSystem: number, goalsInSystem: number): ClientProfileImportReport {
  return {
    dryRun,
    files: files.map((f) => path.basename(path.dirname(f)) + '/' + path.basename(f)),
    rowsRead: { clientAccounts: 0, goalData: 0, goalStats: 0, skippedOtherSheets: 0 },
    accounts: { inSystem: accountsInSystem, profiled: 0, withoutProfile: 0, exportRowsNotInSystem: 0, duplicateExportRows: 0 },
    goals: {
      inSystem: goalsInSystem,
      enriched: 0,
      goalTypeFilledFromOther: 0,
      ultimaSnapshots: 0,
      snapshotAsOfDates: [],
      targetsFromUltima: 0,
    },
    distributions: {},
    unmatchedDistrictValues: [],
  };
}

/**
 * Turns one "Client Accounts" row into a profile draft if its account is in the
 * system. The first row seen for an account wins; Ultima repeats identical rows
 * where its export date ranges overlap.
 */
function collectAccountProfile(
  row: UltimaRow,
  filePath: string,
  accountIdByNumber: Map<string, string>,
  profiles: Map<string, ProfileDraft>,
  report: ClientProfileImportReport,
  unmatchedDistricts: Map<string, number>
): void {
  const accountNumber = cleanOptionalText(row['Account Number']);
  const accountId = accountNumber ? accountIdByNumber.get(accountNumber) : undefined;
  if (!accountId) {
    report.accounts.exportRowsNotInSystem++;
    return;
  }
  if (profiles.has(accountId)) {
    report.accounts.duplicateExportRows++;
    return;
  }

  const location = resolveLocation(row['district']);
  const districtRaw = cleanOptionalText(row['district'])?.slice(0, 120) ?? null;
  if (location.status === 'UNMATCHED' && districtRaw) {
    const key = districtRaw.toLowerCase();
    unmatchedDistricts.set(key, (unmatchedDistricts.get(key) ?? 0) + 1);
  }
  const phone = derivePhoneNetwork(row['Telephone']);
  const source = parseSignupSource(row['Source']);
  const enabledFlag = cleanOptionalText(row['Enabled'])?.toUpperCase();

  profiles.set(accountId, {
    accountId,
    gender: normaliseGender(row['Gender']),
    dateOfBirth: parseDateOfBirth(row['dob']),
    districtRaw,
    districtName: location.districtName,
    country: location.country,
    locationStatus: location.status,
    signupSourceRaw: source.raw,
    signupChannel: source.channel,
    signupPlatform: source.platform,
    signupPartner: source.partner,
    phoneNetwork: phone.network,
    contactClosed: phone.contactClosed,
    userJoinedAt: parseExportDate(row['User Joined On']),
    portalEnabled: enabledFlag === 'ENABLED' ? true : enabledFlag === 'DISABLED' ? false : null,
    enrollmentStatus: cleanOptionalText(row['Activated']),
    sponsorAccountNumber: cleanOptionalText(row['Sponsor Account Number']),
    institutionName: cleanOptionalText(row['Institution Name']),
    sourceFile: path.basename(path.dirname(filePath)) + '/' + path.basename(filePath),
  });
}

/** Captures risk score, goal category, sponsor title and enabled flag for goals in the system. */
function collectGoalEnrichment(row: UltimaRow, goalTypeByNumber: Map<string, GoalType>, goals: Map<string, GoalEnrichment>): void {
  const goalNumber = cleanOptionalText(row['goalNumber']);
  if (!goalNumber || !goalTypeByNumber.has(goalNumber) || goals.has(goalNumber)) return;

  const score = Number(row['riskTolerance']);
  const ultimaGoalName = cleanOptionalText(row['goalName']);
  const enabledFlag = cleanOptionalText(row['disabled'])?.toUpperCase();
  goals.set(goalNumber, {
    goalNumber,
    riskScore: row['riskTolerance'] !== null && Number.isFinite(score) ? Math.min(10, Math.max(0, Math.round(score))) : null,
    ultimaGoalName,
    sponsorTitle: cleanOptionalText(row['goalSponsorTitle']),
    ultimaEnabled: enabledFlag === 'ENABLED' ? true : enabledFlag === 'DISABLED' ? false : null,
    mappedGoalType: ultimaGoalName ? GOAL_TYPE_BY_ULTIMA_NAME[ultimaGoalName.toUpperCase()] ?? null : null,
  });
}

/**
 * Captures Ultima's view of one goal (target, value, net invested, activity) for
 * goals in the system. A target of 0 means "no target set" and is stored as null.
 * Note "lastDeposited" in the export is the last deposit amount and "depositDate"
 * its date.
 */
function collectGoalSnapshot(
  row: UltimaRow,
  filePath: string,
  asOfDate: Date,
  goalIdByNumber: Map<string, string>,
  snapshots: Map<string, GoalSnapshotDraft>
): void {
  const goalNumber = cleanOptionalText(row['goalNumber']);
  const goalId = goalNumber ? goalIdByNumber.get(goalNumber) : undefined;
  if (!goalId) return;
  const key = `${goalId}|${asOfDate.toISOString().slice(0, 10)}`;
  if (snapshots.has(key)) return;

  const amount = (value: unknown) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : 0);
  const target = amount(row['goalTarget']);
  const lastDeposit = amount(row['lastDeposited']);
  const lastDepositDate = parseExportDate(row['depositDate']);
  snapshots.set(key, {
    goalId,
    asOfDate,
    goalTarget: target > 0 ? target : null,
    currentValue: amount(row['currentValue']),
    netInvested: amount(row['netInvested']),
    lastDepositAmount: lastDeposit > 0 ? lastDeposit : null,
    lastDepositDate: lastDepositDate ? new Date(`${lastDepositDate.toISOString().slice(0, 10)}T00:00:00.000Z`) : null,
    depositCount: Math.round(amount(row['depositCount'])),
    withdrawalCount: Math.round(amount(row['withdrawCount'])),
    sourceFile: path.basename(path.dirname(filePath)) + '/' + path.basename(filePath),
  });
}

function summariseGoalSnapshots(report: ClientProfileImportReport, snapshots: Map<string, GoalSnapshotDraft>): void {
  const all = [...snapshots.values()];
  report.goals.ultimaSnapshots = all.length;
  report.goals.snapshotAsOfDates = [...new Set(all.map((s) => s.asOfDate.toISOString().slice(0, 10)))].sort();
  report.goals.targetsFromUltima = new Set(all.filter((s) => s.goalTarget !== null).map((s) => s.goalId)).size;
}

/**
 * Fills the report's counts and value distributions (gender, location, network,
 * channel, risk score...) so a dry run shows exactly what would be written.
 */
function summariseCollectedData(
  report: ClientProfileImportReport,
  profiles: Map<string, ProfileDraft>,
  goals: Map<string, GoalEnrichment>,
  goalTypeByNumber: Map<string, GoalType>,
  unmatchedDistricts: Map<string, number>
): void {
  const tally = (name: string, value: unknown) => {
    const bucket = (report.distributions[name] ??= {});
    const key = value === null || value === undefined ? '(none)' : String(value);
    bucket[key] = (bucket[key] ?? 0) + 1;
  };

  for (const p of profiles.values()) {
    tally('gender', p.gender);
    tally('locationStatus', p.locationStatus);
    tally('region', p.districtName ? regionForDistrict(p.districtName) : null);
    if (p.locationStatus === 'ABROAD') tally('abroadCountry', p.country);
    tally('phoneNetwork', p.phoneNetwork);
    tally('signupChannel', p.signupChannel);
    tally('dateOfBirth', p.dateOfBirth ? 'valid' : 'missing/placeholder');
    tally('contactClosed', p.contactClosed);
    tally('portalEnabled', p.portalEnabled);
  }
  for (const g of goals.values()) {
    tally('goalRiskScore', g.riskScore);
    tally('ultimaGoalName', g.ultimaGoalName);
    if (g.mappedGoalType && goalTypeByNumber.get(g.goalNumber) === GoalType.OTHER) report.goals.goalTypeFilledFromOther++;
  }

  report.accounts.profiled = profiles.size;
  report.accounts.withoutProfile = report.accounts.inSystem - profiles.size;
  report.goals.enriched = goals.size;
  report.unmatchedDistrictValues = [...unmatchedDistricts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([value, accounts]) => ({ value, accounts }));
}

/** Inserts any missing districts from the reference list and returns name -> id. */
async function ensureDistrictReferenceData(): Promise<Map<string, string>> {
  const rows = Object.entries(UGANDA_DISTRICTS_BY_REGION).flatMap(([region, names]) =>
    names.map((name) => ({ name, region: region as keyof typeof UGANDA_DISTRICTS_BY_REGION }))
  );
  await prisma.district.createMany({ data: rows, skipDuplicates: true });
  return new Map((await prisma.district.findMany({ select: { id: true, name: true } })).map((d) => [d.name, d.id]));
}

/** Replaces profiles batch by batch: delete existing rows for the batch's accounts, then insert. */
async function writeAccountProfiles(drafts: ProfileDraft[], districtIdByName: Map<string, string>): Promise<void> {
  for (let i = 0; i < drafts.length; i += WRITE_BATCH_SIZE) {
    const batch = drafts.slice(i, i + WRITE_BATCH_SIZE).map(({ districtName, ...profile }) => ({
      ...profile,
      districtId: districtName ? districtIdByName.get(districtName) ?? null : null,
      importedAt: new Date(),
    }));
    await prisma.$transaction([
      prisma.accountProfile.deleteMany({ where: { accountId: { in: batch.map((p) => p.accountId) } } }),
      prisma.accountProfile.createMany({ data: batch }),
    ]);
    logger.info(`Account profiles written: ${Math.min(i + WRITE_BATCH_SIZE, drafts.length)}/${drafts.length}`);
  }
}

/**
 * Updates goals in batches with one UPDATE ... FROM (VALUES ...) per batch.
 * goalType is only changed where it is still the import default OTHER, so any
 * value set deliberately in the system is preserved.
 */
async function writeGoalEnrichment(enrichments: GoalEnrichment[]): Promise<void> {
  for (let i = 0; i < enrichments.length; i += WRITE_BATCH_SIZE) {
    const values = enrichments.slice(i, i + WRITE_BATCH_SIZE).map(
      (g) =>
        Prisma.sql`(${g.goalNumber}::text, ${g.riskScore}::int, ${g.ultimaGoalName}::text, ${g.sponsorTitle}::text, ${g.ultimaEnabled}::boolean, ${g.mappedGoalType}::text)`
    );
    await prisma.$executeRaw`
      UPDATE goals AS g SET
        "riskScore" = v.risk_score,
        "ultimaGoalName" = v.goal_name,
        "sponsorTitle" = v.sponsor_title,
        "ultimaEnabled" = v.enabled,
        "goalType" = CASE WHEN g."goalType" = 'OTHER' AND v.goal_type IS NOT NULL
                          THEN v.goal_type::"GoalType" ELSE g."goalType" END,
        "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(values)}) AS v(goal_number, risk_score, goal_name, sponsor_title, enabled, goal_type)
      WHERE g."goalNumber" = v.goal_number`;
    logger.info(`Goals enriched: ${Math.min(i + WRITE_BATCH_SIZE, enrichments.length)}/${enrichments.length}`);
  }
}

/** Replaces snapshots per as-of date, batch by batch: delete that date's rows for the batch's goals, then insert. */
async function writeGoalSnapshots(drafts: GoalSnapshotDraft[]): Promise<void> {
  const byAsOfDate = new Map<string, GoalSnapshotDraft[]>();
  for (const draft of drafts) {
    const day = draft.asOfDate.toISOString().slice(0, 10);
    byAsOfDate.set(day, [...(byAsOfDate.get(day) ?? []), draft]);
  }
  for (const [day, dayDrafts] of byAsOfDate) {
    for (let i = 0; i < dayDrafts.length; i += WRITE_BATCH_SIZE) {
      const batch = dayDrafts.slice(i, i + WRITE_BATCH_SIZE).map((d) => ({ ...d, importedAt: new Date() }));
      await prisma.$transaction([
        prisma.ultimaGoalSnapshot.deleteMany({
          where: { asOfDate: new Date(`${day}T00:00:00.000Z`), goalId: { in: batch.map((d) => d.goalId) } },
        }),
        prisma.ultimaGoalSnapshot.createMany({ data: batch }),
      ]);
      logger.info(`Ultima goal snapshots (${day}) written: ${Math.min(i + WRITE_BATCH_SIZE, dayDrafts.length)}/${dayDrafts.length}`);
    }
  }
}

/**
 * Sets Goal.targetAmount from each goal's most recent snapshot that has a target.
 * Goals whose Ultima target is 0 keep whatever targetAmount they already have.
 */
async function writeGoalTargetsFromLatestSnapshot(drafts: GoalSnapshotDraft[]): Promise<void> {
  const latestTargetByGoal = new Map<string, { asOf: number; target: number }>();
  for (const d of drafts) {
    if (d.goalTarget === null) continue;
    const current = latestTargetByGoal.get(d.goalId);
    if (!current || d.asOfDate.getTime() > current.asOf) {
      latestTargetByGoal.set(d.goalId, { asOf: d.asOfDate.getTime(), target: d.goalTarget });
    }
  }
  const entries = [...latestTargetByGoal.entries()];
  for (let i = 0; i < entries.length; i += WRITE_BATCH_SIZE) {
    const values = entries
      .slice(i, i + WRITE_BATCH_SIZE)
      // Sent as text: Prisma binds JS numbers as int8/float8, which Postgres rejects for ::numeric
      .map(([goalId, { target }]) => Prisma.sql`(${goalId}::text, ${target.toString()}::numeric)`);
    await prisma.$executeRaw`
      UPDATE goals AS g SET "targetAmount" = v.target, "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(values)}) AS v(goal_id, target)
      WHERE g.id = v.goal_id`;
  }
  logger.info(`Goal targets set: ${entries.length}`);
}
