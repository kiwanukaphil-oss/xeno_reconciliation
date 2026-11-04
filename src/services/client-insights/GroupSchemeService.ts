import { prisma } from '../../config/database';
import { MIN_REPORTABLE_GROUP_SIZE } from './ClientInsightsService';
import { InsightSources, LATEST_SOURCES } from './InsightSources';

/**
 * Roll-up of member accounts by sponsor (SACCOs, investment clubs, retirement
 * benefit schemes, family groups). Members are linked by the Ultima sponsor
 * account number on their profile. Most sponsor accounts hold no funds and are not
 * in the system, so the group is named from the sponsor's client record when it
 * exists, then the institution name entered on members' profiles, and otherwise
 * by its sponsor account number. (Ultima's goal "sponsor title" holds goal names
 * such as WEALTH or Contributions, so it is not used.)
 */
export class GroupSchemeService {
  static async getGroupSchemes(sources: InsightSources = LATEST_SOURCES) {
    const groups = await prisma.$queryRaw<any[]>`
      WITH members AS (
        SELECT ap."sponsorAccountNumber" AS sponsor_account_number, ap."institutionName" AS institution_name, v.*
        FROM account_profiles ap
        JOIN ${sources.accounts('v')} ON v.account_id = ap."accountId"
        WHERE ap."sponsorAccountNumber" IS NOT NULL
      )
      SELECT m.sponsor_account_number,
             COALESCE(sc."clientName", mode() WITHIN GROUP (ORDER BY m.institution_name),
                      'Sponsor ' || m.sponsor_account_number) AS group_name,
             mode() WITHIN GROUP (ORDER BY m.account_category) AS category,
             s.id IS NOT NULL AS sponsor_in_system,
             COALESCE(MAX(sp.aum), 0)::float8 AS sponsor_own_aum,
             COUNT(*)::int AS members,
             COUNT(*) FILTER (WHERE m.is_funded)::int AS funded_members,
             COALESCE(SUM(m.aum), 0)::float8 AS member_aum,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY m.aum) FILTER (WHERE m.is_funded)::float8 AS median_member_balance,
             COUNT(*) FILTER (WHERE m.deposits_12m > 0)::int AS depositors_12m,
             -- Probability-weighted: declared gender counts as 1/0, name-based estimates as their probability
             COALESCE(SUM(m.female_probability), 0)::float8 AS female_weight,
             COUNT(m.female_probability)::int AS gender_estimable
      FROM members m
      LEFT JOIN accounts s ON s."accountNumber" = m.sponsor_account_number
      LEFT JOIN clients sc ON sc.id = s."clientId"
      LEFT JOIN ${sources.accounts('sp')} ON sp.account_id = s.id
      GROUP BY m.sponsor_account_number, sc."clientName", s.id
      ORDER BY member_aum DESC`;

    const rows = groups.map((g) => {
      return {
        sponsorAccountNumber: g.sponsor_account_number,
        groupName: g.group_name,
        category: g.category,
        sponsorInSystem: g.sponsor_in_system,
        sponsorOwnAum: g.sponsor_own_aum,
        members: g.members,
        fundedMembers: g.funded_members,
        memberAum: g.member_aum,
        medianMemberBalance: g.funded_members >= MIN_REPORTABLE_GROUP_SIZE ? g.median_member_balance : null,
        depositorsLast12Months: g.depositors_12m,
        // Gender mix (declared or estimated) is only shown where enough members have one
        femaleShareOfKnown: g.gender_estimable >= MIN_REPORTABLE_GROUP_SIZE ? g.female_weight / g.gender_estimable : null,
      };
    });

    const byCategory = new Map<string, { category: string; groups: number; members: number; fundedMembers: number; memberAum: number }>();
    for (const row of rows) {
      const entry = byCategory.get(row.category) ?? { category: row.category, groups: 0, members: 0, fundedMembers: 0, memberAum: 0 };
      entry.groups++;
      entry.members += row.members;
      entry.fundedMembers += row.fundedMembers;
      entry.memberAum += row.memberAum;
      byCategory.set(row.category, entry);
    }

    return {
      asOf: sources.asOf,
      summary: {
        groups: rows.length,
        members: rows.reduce((s, r) => s + r.members, 0),
        memberAum: rows.reduce((s, r) => s + r.memberAum, 0),
      },
      byCategory: [...byCategory.values()].sort((a, b) => b.memberAum - a.memberAum),
      groups: rows,
    };
  }
}
