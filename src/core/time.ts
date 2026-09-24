import { DAYS, type Day, type Meeting } from './model';

/** True iff the two meetings are on the same day and their half-open intervals overlap. */
export function meetingsOverlap(a: Meeting, b: Meeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

/** All overlapping meeting pairs between two meeting lists. Empty lists never clash. */
export function overlappingPairs(a: readonly Meeting[], b: readonly Meeting[]): [Meeting, Meeting][] {
  const out: [Meeting, Meeting][] = [];
  for (const x of a) for (const y of b) if (meetingsOverlap(x, y)) out.push([x, y]);
  return out;
}

export function meetingListsClash(a: readonly Meeting[], b: readonly Meeting[]): boolean {
  for (const x of a) for (const y of b) if (meetingsOverlap(x, y)) return true;
  return false;
}

const DAY_ALIASES: Record<string, Day> = {
  m: 'Mon', mo: 'Mon', mon: 'Mon', monday: 'Mon',
  t: 'Tue', tu: 'Tue', tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
  w: 'Wed', we: 'Wed', wed: 'Wed', wednesday: 'Wed',
  th: 'Thu', thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  f: 'Fri', fr: 'Fri', fri: 'Fri', friday: 'Fri',
  sa: 'Sat', sat: 'Sat', saturday: 'Sat',
  su: 'Sun', sun: 'Sun', sunday: 'Sun',
};

export function parseDay(input: string): Day | null {
  return DAY_ALIASES[input.trim().toLowerCase().replace(/\.$/, '')] ?? null;
}

/**
 * Parse a clock time into minutes since midnight.
 * Accepts `HH:MM`, `H:MM`, `HH.MM`, `HHMM` (24h), optionally followed by AM/PM.
 * Returns null for anything else — callers must surface the error, never guess.
 */
export function parseTime(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.](\d{2})|(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? '0');
  const suffix = m[4]?.replace(/\./g, '');
  if (min > 59) return null;
  // A bare number without minutes or suffix (e.g. "9") is too ambiguous to accept.
  if (m[2] === undefined && m[3] === undefined && !suffix) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) return null;
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatMeeting(m: Meeting): string {
  return `${m.day} ${formatTime(m.start)}–${formatTime(m.end)}`;
}

export function dayIndex(d: Day): number {
  return DAYS.indexOf(d);
}
