import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { UltimaRow } from './UltimaExportReader';
import { cleanOptionalText, parseExportDate, parseSignupSource } from './ProfileFieldNormalizer';

/** Sign-up channels of the XENO_Metrics report ("New Registered: Web / Android / iOS / MTN - USSD / Airtel - USSD"). */
export type SignupChannel = 'WEB' | 'ANDROID' | 'IOS' | 'MTN_USSD' | 'AIRTEL_USSD' | 'OTHER';

export interface SignupMonthlyCount {
  month: string; // YYYY-MM
  channel: SignupChannel;
  newAccounts: number;
  newUsers: number;
}

/** Ultima "Source" -> report channel: MTN = MTN USSD, WEB_* = Web, APP_ANDROID_* = Android, APP_IOS_* = iOS. */
export function signupChannelFor(source: unknown): SignupChannel {
  const parsed = parseSignupSource(source);
  if (parsed.channel === 'MTN') return 'MTN_USSD';
  if (parsed.channel === 'AIRTEL') return 'AIRTEL_USSD';
  if (parsed.channel === 'WEB') return 'WEB';
  if (parsed.channel === 'APP' && parsed.platform === 'ANDROID') return 'ANDROID';
  if (parsed.channel === 'APP' && parsed.platform === 'IOS') return 'IOS';
  return 'OTHER';
}

/** A phone number as a user key: "closed_" prefixes removed, last 9 digits (256XXXXXXXXX = 0XXXXXXXXX = XXXXXXXXX). */
function userKeyFor(telephone: unknown): string | null {
  const digits = (cleanOptionalText(telephone) ?? '').replace(/^(closed_)+/i, '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

const monthOf = (date: Date) => date.toISOString().slice(0, 7);

/**
 * Counts Ultima sign-ups per month and channel from "Client Accounts" rows, keeping only the counts:
 * phone numbers are used in memory to tell people apart and are never stored.
 *
 * - New accounts (report "New Registered"): every account, by the month it was created.
 * - New users (month-on-month growth of report "Registered"): distinct people (phone numbers) by the
 *   month they joined, deduplicated across the run and attributed to the channel of their earliest
 *   account. Users are only counted for months whose accounts are in the run, so importing one month's
 *   export never touches earlier months; a user who joined in one month but opened their first account
 *   in a later one is only caught when both months are imported together (e.g. the full history export).
 *
 * Rows are deduplicated on account number across all files of one import run. The run replaces the
 * stored counts of every month it saw, so a multi-part full export must be imported with all its parts.
 */
export class SignupCountCollector {
  private readonly seenAccounts = new Set<string>();
  private readonly accountsByMonthChannel = new Map<string, number>();
  private readonly firstJoinByUser = new Map<string, { joinMonth: string; createdAt: number; channel: SignupChannel }>();
  private readonly usersWithoutPhone = new Map<string, number>();

  add(row: UltimaRow): void {
    const accountNumber = cleanOptionalText(row['Account Number']);
    const created = parseExportDate(row['Account Created On']);
    if (!accountNumber || !created || this.seenAccounts.has(accountNumber)) return;
    this.seenAccounts.add(accountNumber);

    const channel = signupChannelFor(row['Source']);
    const accountKey = `${monthOf(created)}|${channel}`;
    this.accountsByMonthChannel.set(accountKey, (this.accountsByMonthChannel.get(accountKey) ?? 0) + 1);

    const joined = parseExportDate(row['User Joined On']) ?? created;
    const joinMonth = monthOf(joined);
    const user = userKeyFor(row['Telephone']);
    if (!user) {
      // No usable phone number: count the account as its own user
      const userKey = `${joinMonth}|${channel}`;
      this.usersWithoutPhone.set(userKey, (this.usersWithoutPhone.get(userKey) ?? 0) + 1);
      return;
    }
    const known = this.firstJoinByUser.get(user);
    const isEarlier = !known || joinMonth < known.joinMonth || (joinMonth === known.joinMonth && created.getTime() < known.createdAt);
    if (isEarlier) this.firstJoinByUser.set(user, { joinMonth, createdAt: created.getTime(), channel });
  }

  get accountsCounted(): number {
    return this.seenAccounts.size;
  }

  /** Counts per month and channel, sorted by month then channel. */
  counts(): SignupMonthlyCount[] {
    const rows = new Map<string, SignupMonthlyCount>();
    const rowFor = (key: string) => {
      let row = rows.get(key);
      if (!row) {
        const [month, channel] = key.split('|') as [string, SignupChannel];
        row = { month, channel, newAccounts: 0, newUsers: 0 };
        rows.set(key, row);
      }
      return row;
    };
    for (const [key, n] of this.accountsByMonthChannel) rowFor(key).newAccounts += n;
    // Months this run holds accounts for; users who joined in any other month are left to that month's import
    const coveredMonths = new Set([...this.accountsByMonthChannel.keys()].map((key) => key.split('|')[0]));
    for (const [key, n] of this.usersWithoutPhone) {
      if (coveredMonths.has(key.split('|')[0])) rowFor(key).newUsers += n;
    }
    for (const { joinMonth, channel } of this.firstJoinByUser.values()) {
      if (coveredMonths.has(joinMonth)) rowFor(`${joinMonth}|${channel}`).newUsers += 1;
    }
    return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.channel.localeCompare(b.channel));
  }

  /** Replaces the stored counts of every month this run saw, in one transaction. Returns the months written. */
  async write(): Promise<string[]> {
    const counts = this.counts();
    const months = [...new Set(counts.map((c) => c.month))];
    if (months.length === 0) return [];
    await prisma.$transaction([
      prisma.$executeRaw`
        DELETE FROM ultima_signup_monthly_counts
        WHERE month IN (${Prisma.join(months.map((m) => Prisma.sql`${`${m}-01`}::date`))})`,
      prisma.$executeRaw`
        INSERT INTO ultima_signup_monthly_counts (month, channel, "newAccounts", "newUsers")
        VALUES ${Prisma.join(counts.map((c) => Prisma.sql`(${`${c.month}-01`}::date, ${c.channel}, ${c.newAccounts}, ${c.newUsers})`))}`,
    ]);
    return months;
  }
}
