import { Gender, LocationStatus, PhoneNetwork, UgandaRegion } from '@prisma/client';
import {
  BLANK_DISTRICT_VALUES,
  DISTRICT_ALIASES,
  FOREIGN_LOCATIONS,
  UGANDA_DISTRICTS_BY_REGION,
} from './ugandaDistricts';

export interface ResolvedLocation {
  status: LocationStatus;
  districtName: string | null;
  region: UgandaRegion | null;
  country: string | null;
}

export interface ParsedSignupSource {
  raw: string | null;
  channel: string | null;
  platform: string | null;
  partner: string | null;
}

// Lower-cased canonical name -> canonical name, built once from the region lists
const CANONICAL_DISTRICTS = new Map<string, string>();
const REGION_BY_DISTRICT = new Map<string, UgandaRegion>();
for (const [region, names] of Object.entries(UGANDA_DISTRICTS_BY_REGION) as [UgandaRegion, string[]][]) {
  for (const name of names) {
    CANONICAL_DISTRICTS.set(normaliseLocationText(name), name);
    REGION_BY_DISTRICT.set(name, region);
  }
}

// Words clients add around a district name ("Wakiso District", "Lira City", "Wilaya ya Buikwe")
const LOCATION_NOISE_WORDS = /\b(district|city|municipality|municipal|division|town|council|wilaya ya|uganda|county)\b/g;
const PLACEHOLDER_DOB = '1970-01-01';
const EARLIEST_PLAUSIBLE_BIRTH_YEAR = 1920;

/**
 * Lower-cases, strips accents and punctuation, and collapses whitespace so that
 * "  Wakiso-District " and "wakiso district" compare equal.
 */
export function normaliseLocationText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns null for empty cells and Ultima's "N/A"-style placeholders. */
export function cleanOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || ['n/a', 'na', 'none', 'null', '-'].includes(text.toLowerCase())) return null;
  return text;
}

/** Maps the 14 spellings seen in Ultima ("male", "F", "Rather Not say", "Famale"...) to the Gender enum. */
export function normaliseGender(value: unknown): Gender {
  const text = cleanOptionalText(value)?.toLowerCase().replace(/_/g, ' ');
  if (!text) return Gender.UNKNOWN;
  if (text === 'male' || text === 'm') return Gender.MALE;
  if (text === 'female' || text === 'f' || text === 'famale') return Gender.FEMALE;
  if (text.startsWith('rather not')) return Gender.UNDISCLOSED;
  return Gender.UNKNOWN;
}

/**
 * Parses date of birth from an Excel date or ISO-like string, rejecting Ultima's
 * 1970-01-01 placeholder, implausibly old dates and dates in the future.
 */
export function parseDateOfBirth(value: unknown, today: Date = new Date()): Date | null {
  const date = parseExportDate(value);
  if (!date) return null;
  const isoDay = date.toISOString().slice(0, 10);
  if (isoDay === PLACEHOLDER_DOB) return null;
  if (date.getUTCFullYear() < EARLIEST_PLAUSIBLE_BIRTH_YEAR || date > today) return null;
  return new Date(`${isoDay}T00:00:00.000Z`);
}

/** Accepts Excel dates (Date objects or serial numbers) and "YYYY-MM-DD[ HH:mm:ss]" strings. */
export function parseExportDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Excel serial day count from 1899-12-30; only plausible ranges (1900-2119) are accepted
    return value > 0 && value < 80000 ? new Date(Math.round((value - 25569) * 86400 * 1000)) : null;
  }
  const text = cleanOptionalText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const date = new Date(text.replace(' ', 'T') + (text.length <= 10 ? 'T00:00:00Z' : 'Z'));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Derives the mobile network from a Ugandan phone number prefix. Ultima stores
 * numbers as 9 local digits, 256XXXXXXXXX or 0XXXXXXXXX, and prefixes closed
 * users with "closed_" (possibly repeated). Returns whether that prefix was present.
 */
export function derivePhoneNetwork(value: unknown): { network: PhoneNetwork; contactClosed: boolean } {
  const text = cleanOptionalText(value);
  if (!text) return { network: PhoneNetwork.UNKNOWN, contactClosed: false };
  const contactClosed = /^(closed_?)+/i.test(text);
  const digits = text.replace(/^(closed_?)+/i, '').replace(/\D/g, '');

  let localNumber: string | null = null;
  if (digits.length === 9) localNumber = digits;
  else if (digits.length === 10 && digits.startsWith('0')) localNumber = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('256')) localNumber = digits.slice(3);
  else if (digits.length >= 10) return { network: PhoneNetwork.FOREIGN, contactClosed };

  if (!localNumber) return { network: PhoneNetwork.UNKNOWN, contactClosed };
  const prefix = localNumber.slice(0, 2);
  if (['76', '77', '78'].includes(prefix)) return { network: PhoneNetwork.MTN, contactClosed };
  if (['70', '74', '75'].includes(prefix)) return { network: PhoneNetwork.AIRTEL, contactClosed };
  return { network: PhoneNetwork.OTHER_UG, contactClosed };
}

/** Splits Ultima "Source" (e.g. APP_ANDROID_MTN, WEB_AIRTEL, MTN) into channel, platform and partner. */
export function parseSignupSource(value: unknown): ParsedSignupSource {
  const raw = cleanOptionalText(value)?.toUpperCase() ?? null;
  if (!raw) return { raw: null, channel: null, platform: null, partner: null };
  const parts = raw.split('_');
  const channel = parts[0];
  const platform = parts.find((p) => p === 'ANDROID' || p === 'IOS') ?? null;
  const partner = channel === 'MTN' ? 'MTN' : parts.slice(1).find((p) => p === 'MTN' || p === 'AIRTEL') ?? null;
  return { raw, channel, platform, partner };
}

/**
 * Resolves free-text district input in stages, from most to least certain:
 * blank check -> exact district/alias -> with noise words removed -> each word ->
 * foreign location -> name prefix -> small-typo match. Anything left is UNMATCHED
 * and keeps its raw text so the reference lists can be extended and re-run.
 */
export function resolveLocation(value: unknown): ResolvedLocation {
  const missing: ResolvedLocation = { status: LocationStatus.MISSING, districtName: null, region: null, country: null };
  const raw = cleanOptionalText(value);
  if (!raw) return missing;
  const full = normaliseLocationText(raw);
  if (BLANK_DISTRICT_VALUES.has(full)) return missing;

  const stripped = full.replace(LOCATION_NOISE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return missing;
  const candidates = [full, stripped, ...stripped.split(' ')];

  for (const candidate of candidates) {
    const district = lookupUgandaDistrict(candidate);
    if (district) return ugandaLocation(district);
  }
  for (const candidate of [full, stripped, ...stripped.split(' ')]) {
    const country = FOREIGN_LOCATIONS[candidate];
    if (country) return { status: LocationStatus.ABROAD, districtName: null, region: null, country };
  }

  const prefixMatch = findDistrictByPrefix(stripped.replace(/ /g, ''));
  if (prefixMatch) return ugandaLocation(prefixMatch);
  const typoMatch = findDistrictWithinTypoDistance(stripped);
  if (typoMatch) return ugandaLocation(typoMatch);

  return { status: LocationStatus.UNMATCHED, districtName: null, region: null, country: null };
}

export function regionForDistrict(districtName: string): UgandaRegion {
  const region = REGION_BY_DISTRICT.get(districtName);
  if (!region) throw new Error(`Unknown district: ${districtName}`);
  return region;
}

function ugandaLocation(districtName: string): ResolvedLocation {
  return {
    status: LocationStatus.UGANDA_DISTRICT,
    districtName,
    region: regionForDistrict(districtName),
    country: 'Uganda',
  };
}

function lookupUgandaDistrict(candidate: string): string | null {
  return CANONICAL_DISTRICTS.get(candidate) ?? DISTRICT_ALIASES[candidate] ?? null;
}

// Handles run-together input such as "kampalamakindye" (district name of 5+ letters at the start)
function findDistrictByPrefix(compact: string): string | null {
  for (const [key, name] of CANONICAL_DISTRICTS) {
    if (key.length >= 5 && !key.includes(' ') && compact.startsWith(key)) return name;
  }
  return null;
}

/**
 * Accepts a district whose spelling is within 1 edit (2 for names of 8+ letters),
 * counting a swapped pair of letters as one edit. Only accepted when exactly one
 * district is that close, so ambiguous input stays UNMATCHED.
 */
function findDistrictWithinTypoDistance(text: string): string | null {
  if (text.length < 5) return null;
  const allowed = text.length >= 8 ? 2 : 1;
  const matches = new Set<string>();
  for (const [key, name] of CANONICAL_DISTRICTS) {
    if (Math.abs(key.length - text.length) > allowed) continue;
    if (editDistanceWithTranspositions(text, key) <= allowed) matches.add(name);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
function editDistanceWithTranspositions(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}
