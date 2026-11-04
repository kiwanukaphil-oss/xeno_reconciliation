/**
 * Gender reporting from Ultima's declared gender only, in one of two views:
 *
 * - IDENTIFIED: only clients with a declared Female or Male gender are counted.
 * - ALLOCATED: every client is counted. Clients with no declared gender (missing,
 *   or "rather not say") are split between Female and Male in the known ratio, so
 *   Female + Male add up to the full total. Accounts are split by the known account
 *   ratio and AUM by the known AUM ratio.
 *
 * When a group (a row of another breakdown, e.g. MTN sign-ups) is split, its own known
 * ratio is used if it has at least MIN_IDENTIFIED_FOR_OWN_RATIO identified clients;
 * otherwise the ratio of the whole segment is used. Allocated figures are statistical
 * estimates for aggregate reporting, never a statement about an individual client.
 */
export type GenderView = 'IDENTIFIED' | 'ALLOCATED';
export const GENDER_VIEWS: GenderView[] = ['IDENTIFIED', 'ALLOCATED'];

/** A group needs this many identified clients before its own ratio is trusted. */
export const MIN_IDENTIFIED_FOR_OWN_RATIO = 30;

/** Raw declared-gender counts and values for one group (fractional only after allocation). */
export interface GenderTally {
  femaleCount: number;
  maleCount: number;
  femaleValue: number;
  maleValue: number;
  unidentifiedCount: number;
  unidentifiedValue: number;
}

/** OWN_RATIO / SEGMENT_RATIO: allocated with that ratio; NONE: nothing to allocate or no ratio available. */
export type AllocationBasis = 'IDENTIFIED_ONLY' | 'OWN_RATIO' | 'SEGMENT_RATIO' | 'NONE';

/** Female/male figures for one group under the chosen view. */
export interface GenderSplit {
  femaleCount: number;
  maleCount: number;
  femaleValue: number;
  maleValue: number;
  /** Clients with a declared Female or Male gender (before any allocation). */
  identifiedCount: number;
  /** Clients without one; allocated in ALLOCATED view, left out in IDENTIFIED view. */
  unidentifiedCount: number;
  femaleShareOfCount: number | null;
  femaleShareOfValue: number | null;
  basis: AllocationBasis;
}

export const EMPTY_TALLY: GenderTally = {
  femaleCount: 0,
  maleCount: 0,
  femaleValue: 0,
  maleValue: 0,
  unidentifiedCount: 0,
  unidentifiedValue: 0,
};

/**
 * SELECT-list fragment tallying declared gender for GROUP BY queries. Both arguments
 * are fixed SQL from the calling service (never user input). Gender may be NULL where a
 * LEFT JOIN found no profile; that counts as unidentified.
 */
export function genderTallySql(genderColumn = 'gender', valueExpression = 'aum'): string {
  const g = `COALESCE(${genderColumn}, 'UNKNOWN')`;
  return `
    COUNT(*) FILTER (WHERE ${g} = 'FEMALE')::int AS g_female_count,
    COUNT(*) FILTER (WHERE ${g} = 'MALE')::int AS g_male_count,
    COALESCE(SUM(${valueExpression}) FILTER (WHERE ${g} = 'FEMALE'), 0)::float8 AS g_female_value,
    COALESCE(SUM(${valueExpression}) FILTER (WHERE ${g} = 'MALE'), 0)::float8 AS g_male_value,
    COUNT(*) FILTER (WHERE ${g} NOT IN ('FEMALE', 'MALE'))::int AS g_unidentified_count,
    COALESCE(SUM(${valueExpression}) FILTER (WHERE ${g} NOT IN ('FEMALE', 'MALE')), 0)::float8 AS g_unidentified_value`;
}

/** Reads the columns produced by genderTallySql from one result row. */
export function readGenderTally(row: any): GenderTally {
  return {
    femaleCount: row.g_female_count ?? 0,
    maleCount: row.g_male_count ?? 0,
    femaleValue: row.g_female_value ?? 0,
    maleValue: row.g_male_value ?? 0,
    unidentifiedCount: row.g_unidentified_count ?? 0,
    unidentifiedValue: row.g_unidentified_value ?? 0,
  };
}

export function addGenderTallies(tallies: GenderTally[]): GenderTally {
  return tallies.reduce(
    (t, x) => ({
      femaleCount: t.femaleCount + x.femaleCount,
      maleCount: t.maleCount + x.maleCount,
      femaleValue: t.femaleValue + x.femaleValue,
      maleValue: t.maleValue + x.maleValue,
      unidentifiedCount: t.unidentifiedCount + x.unidentifiedCount,
      unidentifiedValue: t.unidentifiedValue + x.unidentifiedValue,
    }),
    EMPTY_TALLY
  );
}

/**
 * Female/male figures for one group. In IDENTIFIED view these are the declared counts.
 * In ALLOCATED view the unidentified count and value are added in the known ratio: the
 * group's own if it has enough identified clients, else the segment's (`fallback`).
 * Count and value are allocated with their own ratios (a value ratio needs identified
 * value; if there is none, the count ratio stands in).
 */
export function splitGender(tally: GenderTally, view: GenderView, fallback: GenderTally): GenderSplit {
  const identifiedCount = tally.femaleCount + tally.maleCount;
  let female = { count: tally.femaleCount, value: tally.femaleValue };
  let male = { count: tally.maleCount, value: tally.maleValue };
  let basis: AllocationBasis = 'IDENTIFIED_ONLY';

  if (view === 'ALLOCATED') {
    const source = identifiedCount >= MIN_IDENTIFIED_FOR_OWN_RATIO ? tally : fallback;
    const countRatio = ratio(source.femaleCount, source.femaleCount + source.maleCount);
    const valueRatio = ratio(source.femaleValue, source.femaleValue + source.maleValue) ?? countRatio;
    if (tally.unidentifiedCount === 0) {
      basis = 'NONE';
    } else if (countRatio === null || valueRatio === null) {
      basis = 'NONE'; // no identified clients anywhere: nothing to allocate by
    } else {
      basis = source === tally ? 'OWN_RATIO' : 'SEGMENT_RATIO';
      female = {
        count: female.count + tally.unidentifiedCount * countRatio,
        value: female.value + tally.unidentifiedValue * valueRatio,
      };
      male = {
        count: male.count + tally.unidentifiedCount * (1 - countRatio),
        value: male.value + tally.unidentifiedValue * (1 - valueRatio),
      };
    }
  }

  return {
    femaleCount: female.count,
    maleCount: male.count,
    femaleValue: female.value,
    maleValue: male.value,
    identifiedCount,
    unidentifiedCount: tally.unidentifiedCount,
    femaleShareOfCount: ratio(female.count, female.count + male.count),
    femaleShareOfValue: ratio(female.value, female.value + male.value),
    basis,
  };
}

/**
 * Female and male totals of one measure (e.g. goals reached) under the chosen view:
 * the declared figures, plus in ALLOCATED view the unidentified figure split in the
 * declared female:male ratio of that same measure.
 */
export function allocateMeasure(female: number, male: number, unidentified: number, view: GenderView): { female: number; male: number } {
  const femaleRatio = ratio(female, female + male);
  if (view === 'IDENTIFIED' || femaleRatio === null) return { female, male };
  return { female: female + unidentified * femaleRatio, male: male + unidentified * (1 - femaleRatio) };
}

/** One-line description of how gender figures were produced, for notes under tables. */
export function describeGenderView(view: GenderView): string {
  return view === 'IDENTIFIED'
    ? 'Gender identified clients only: clients without a declared gender are left out.'
    : 'All clients: those without a declared gender (missing or "rather not say") are split between Female and Male in the ratio of identified clients, ' +
        `using each group's own ratio where it has ${MIN_IDENTIFIED_FOR_OWN_RATIO}+ identified clients, else the segment's. Allocated figures are estimates.`;
}

function ratio(part: number, whole: number): number | null {
  return whole ? part / whole : null;
}
