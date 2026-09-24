import type { Course, Section } from './model';
import { meetingListsClash } from './time';
import { sectionClash, type SectionClash } from './clash';

export interface SolveOptions {
  /** Section ids the student has marked unavailable (full / vanished on the portal). */
  unavailable?: ReadonlySet<string>;
  /** Stop storing combinations after this many (counting continues up to countLimit). */
  limit?: number;
  /** Stop counting after this many. */
  countLimit?: number;
}

export interface EmptyComponent {
  courseCode: string;
  component: string;
  /** Sections that exist but were marked unavailable. */
  unavailableSections: string[];
}

export interface Diagnosis {
  /** Components that have no available section at all. */
  emptyComponents: EmptyComponent[];
  /** Smallest set of courses (found by deletion) that together have no clash-free combination. */
  minimalConflict: string[];
  /** Courses whose removal alone makes the remaining selection feasible. */
  culprits: string[];
  /** Course pairs where every section of one clashes with every section of the other. */
  pairwise: { a: string; b: string }[];
  /** Section clashes among the courses in minimalConflict (what actually blocks them). */
  blockingClashes: SectionClash[];
  /** Adding courses in selection order, the first one that breaks feasibility. */
  firstBreaking: string | null;
}

export interface SolveResult {
  /** Each combination lists one section per (course, component), in input order. */
  combinations: Section[][];
  /** Total clash-free combinations found (capped at countLimit). */
  count: number;
  truncated: boolean;
  countCapped: boolean;
  diagnosis: Diagnosis | null;
}

interface Variable {
  courseCode: string;
  component: string;
  order: number;
  sections: Section[];
}

function variablesFor(courses: readonly Course[], unavailable: ReadonlySet<string>): Variable[] {
  const vars: Variable[] = [];
  for (const c of courses)
    for (const comp of c.components)
      vars.push({
        courseCode: c.code,
        component: comp.name,
        order: vars.length,
        sections: comp.sections.filter((s) => !unavailable.has(s.id)),
      });
  return vars;
}

/**
 * Depth-first enumeration of clash-free assignments. `visit` returns false to stop.
 * Variables with fewer sections go first (fail fast); the result is re-ordered to input order.
 */
function enumerate(vars: Variable[], visit: (combo: Section[]) => boolean): void {
  if (vars.some((v) => v.sections.length === 0)) return;
  const ordered = [...vars].sort((a, b) => a.sections.length - b.sections.length || a.order - b.order);
  const chosen: Section[] = new Array(ordered.length);
  let stop = false;

  const rec = (depth: number): void => {
    if (stop) return;
    if (depth === ordered.length) {
      const combo: Section[] = new Array(ordered.length);
      ordered.forEach((v, i) => (combo[v.order] = chosen[i]));
      if (!visit(combo)) stop = true;
      return;
    }
    for (const s of ordered[depth].sections) {
      let ok = true;
      for (let i = 0; i < depth; i++)
        if (meetingListsClash(s.meetings, chosen[i].meetings)) {
          ok = false;
          break;
        }
      if (!ok) continue;
      chosen[depth] = s;
      rec(depth + 1);
      if (stop) return;
    }
  };
  rec(0);
}

export function isFeasible(courses: readonly Course[], unavailable: ReadonlySet<string> = new Set()): boolean {
  let found = false;
  enumerate(variablesFor(courses, unavailable), () => {
    found = true;
    return false;
  });
  return found;
}

export function solve(courses: readonly Course[], opts: SolveOptions = {}): SolveResult {
  const unavailable = opts.unavailable ?? new Set<string>();
  const limit = opts.limit ?? 500;
  const countLimit = Math.max(opts.countLimit ?? 100_000, limit);
  const combinations: Section[][] = [];
  let count = 0;

  enumerate(variablesFor(courses, unavailable), (combo) => {
    count++;
    if (combinations.length < limit) combinations.push(combo);
    return count < countLimit;
  });

  return {
    combinations,
    count,
    truncated: count > combinations.length,
    countCapped: count >= countLimit,
    diagnosis: count === 0 && courses.length > 0 ? diagnose(courses, unavailable) : null,
  };
}

export function diagnose(courses: readonly Course[], unavailable: ReadonlySet<string> = new Set()): Diagnosis {
  const emptyComponents: EmptyComponent[] = [];
  for (const c of courses)
    for (const comp of c.components)
      if (comp.sections.every((s) => unavailable.has(s.id)))
        emptyComponents.push({
          courseCode: c.code,
          component: comp.name,
          unavailableSections: comp.sections.map((s) => s.section),
        });

  // Deletion filter: drop any course whose removal keeps the set infeasible.
  let conflict = [...courses];
  for (const c of courses) {
    const without = conflict.filter((x) => x !== c);
    if (without.length < conflict.length && !isFeasible(without, unavailable)) conflict = without;
  }

  const culprits =
    courses.length > 1
      ? courses.filter((c) => isFeasible(courses.filter((x) => x !== c), unavailable)).map((c) => c.code)
      : courses.map((c) => c.code);

  const pairwise: { a: string; b: string }[] = [];
  for (let i = 0; i < courses.length; i++)
    for (let j = i + 1; j < courses.length; j++)
      if (!isFeasible([courses[i], courses[j]], unavailable)) pairwise.push({ a: courses[i].code, b: courses[j].code });

  const blockingClashes: SectionClash[] = [];
  const avail = (c: Course) => c.components.flatMap((comp) => comp.sections.filter((s) => !unavailable.has(s.id)));
  for (let i = 0; i < conflict.length; i++) {
    const own = avail(conflict[i]);
    // Components of the same course (e.g. TEL theory vs lab) can block each other too.
    for (let x = 0; x < own.length; x++)
      for (let y = x + 1; y < own.length; y++)
        if (own[x].component !== own[y].component) {
          const cl = sectionClash(own[x], own[y]);
          if (cl) blockingClashes.push(cl);
        }
    for (let j = i + 1; j < conflict.length; j++)
      for (const a of own)
        for (const b of avail(conflict[j])) {
          const cl = sectionClash(a, b);
          if (cl) blockingClashes.push(cl);
        }
  }

  let firstBreaking: string | null = null;
  for (let i = 1; i <= courses.length; i++)
    if (!isFeasible(courses.slice(0, i), unavailable)) {
      firstBreaking = courses[i - 1].code;
      break;
    }

  return {
    emptyComponents,
    firstBreaking,
    minimalConflict: conflict.map((c) => c.code),
    culprits,
    pairwise,
    blockingClashes,
  };
}

export interface ComboStats {
  credits: number;
  days: number;
  /** Idle minutes between the first and last class on each day, summed. */
  gapMinutes: number;
  earliestStart: number | null;
  latestEnd: number | null;
}

export function comboStats(combo: readonly Section[], courses: readonly Course[]): ComboStats {
  const codes = new Set(combo.map((s) => s.courseCode));
  const credits = courses.filter((c) => codes.has(c.code)).reduce((t, c) => t + c.credits, 0);
  const byDay = new Map<string, { start: number; end: number }[]>();
  for (const s of combo) for (const m of s.meetings) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
  let gapMinutes = 0;
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  for (const ms of byDay.values()) {
    ms.sort((a, b) => a.start - b.start);
    let busyEnd = ms[0].start;
    for (const m of ms) {
      if (m.start > busyEnd) gapMinutes += m.start - busyEnd;
      busyEnd = Math.max(busyEnd, m.end);
    }
    earliestStart = Math.min(earliestStart ?? Infinity, ms[0].start);
    latestEnd = Math.max(latestEnd ?? -Infinity, busyEnd);
  }
  return { credits, days: byDay.size, gapMinutes, earliestStart, latestEnd };
}
