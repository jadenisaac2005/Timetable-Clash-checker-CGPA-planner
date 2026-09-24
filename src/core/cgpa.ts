export interface Grade {
  grade: string;
  points: number;
  /** false for grades that carry no credit weight (e.g. audit / withdrawn). Default true. */
  counts?: boolean;
}

export interface GradeScale {
  name: string;
  grades: Grade[];
}

/**
 * A common 10-point scale. Institutions differ — students must check their own grade card.
 */
export const DEFAULT_SCALE: GradeScale = {
  name: 'Common 10-point scale (verify against your grade card)',
  grades: [
    { grade: 'O', points: 10 },
    { grade: 'A+', points: 9 },
    { grade: 'A', points: 8 },
    { grade: 'B+', points: 7 },
    { grade: 'B', points: 6 },
    { grade: 'C', points: 5 },
    { grade: 'P', points: 4 },
    { grade: 'F', points: 0 },
  ],
};

export function scaleBounds(scale: GradeScale): { min: number; max: number } {
  const pts = scale.grades.filter((g) => g.counts !== false).map((g) => g.points);
  return { min: Math.min(...pts), max: Math.max(...pts) };
}

export function gradePoint(scale: GradeScale, grade: string): Grade | undefined {
  const g = grade.trim().toUpperCase();
  return scale.grades.find((x) => x.grade.toUpperCase() === g);
}

export interface Tally {
  credits: number;
  /** Σ grade point × credits */
  points: number;
}

export const EMPTY: Tally = { credits: 0, points: 0 };

export function add(a: Tally, b: Tally): Tally {
  return { credits: a.credits + b.credits, points: a.points + b.points };
}

export function gpa(t: Tally): number | null {
  return t.credits > 0 ? t.points / t.credits : null;
}

export interface GradedCourse {
  code?: string;
  credits: number;
  grade: string;
}

export type PastSemester =
  | { kind: 'sgpa'; label?: string; sgpa: number; credits: number }
  | { kind: 'courses'; label?: string; courses: GradedCourse[] };

/** Throws on an unknown grade so a typo can never silently count as 0. */
export function tallyCourses(courses: readonly GradedCourse[], scale: GradeScale): Tally {
  let t = EMPTY;
  for (const c of courses) {
    const g = gradePoint(scale, c.grade);
    if (!g) throw new Error(`Unknown grade "${c.grade}"${c.code ? ` for ${c.code}` : ''}`);
    if (g.counts === false) continue;
    t = add(t, { credits: c.credits, points: g.points * c.credits });
  }
  return t;
}

export function tallySemester(s: PastSemester, scale: GradeScale): Tally {
  return s.kind === 'sgpa' ? { credits: s.credits, points: s.sgpa * s.credits } : tallyCourses(s.courses, scale);
}

export function tallyAll(sems: readonly PastSemester[], scale: GradeScale): Tally {
  return sems.reduce((t, s) => add(t, tallySemester(s, scale)), EMPTY);
}

export type TargetStatus =
  /** Needs an average between the scale's min and max on the remaining credits. */
  | 'reachable'
  /** Needs more than the maximum grade point on every remaining credit. */
  | 'unreachable'
  /** Even the minimum grade point everywhere keeps the CGPA at or above target. */
  | 'guaranteed'
  /** No remaining credits: the CGPA is fixed. */
  | 'no-remaining';

export interface TargetResult {
  status: TargetStatus;
  /** Average grade point needed on the remaining credits (may be outside the scale). */
  required: number | null;
  /** Best CGPA attainable (all max grades). */
  best: number | null;
  /** Worst CGPA attainable (all min grades). */
  worst: number | null;
}

const EPS = 1e-9;

/**
 * Average grade point required on `remainingCredits` so the final CGPA reaches `target`.
 *   target = (points + r × remaining) / (credits + remaining)  ⇒  r = (target × total − points) / remaining
 */
export function requiredAverage(current: Tally, remainingCredits: number, target: number, scale: GradeScale): TargetResult {
  const { min, max } = scaleBounds(scale);
  const total = current.credits + remainingCredits;
  if (remainingCredits <= 0) {
    const g = gpa(current);
    return { status: 'no-remaining', required: null, best: g, worst: g };
  }
  const required = (target * total - current.points) / remainingCredits;
  const best = (current.points + max * remainingCredits) / total;
  const worst = (current.points + min * remainingCredits) / total;
  const status: TargetStatus = required > max + EPS ? 'unreachable' : required <= min + EPS ? 'guaranteed' : 'reachable';
  return { status, required, best, worst };
}

/** CGPA after adding planned courses with expected grades. */
export function projectCgpa(current: Tally, planned: readonly GradedCourse[], scale: GradeScale): { sgpa: number | null; cgpa: number | null; tally: Tally } {
  const sem = tallyCourses(planned, scale);
  const tally = add(current, sem);
  return { sgpa: gpa(sem), cgpa: gpa(tally), tally };
}

/** Validate a user-supplied scale; returns error messages (empty = valid). */
export function validateScale(scale: GradeScale): string[] {
  const errs: string[] = [];
  if (!Array.isArray(scale?.grades)) return ['Scale has no grades'];
  if (!scale.grades.length) errs.push('Scale has no grades');
  const seen = new Set<string>();
  for (const g of scale.grades ?? []) {
    if (!g.grade?.trim()) errs.push('A grade has an empty name');
    else if (seen.has(g.grade.toUpperCase())) errs.push(`Duplicate grade "${g.grade}"`);
    else seen.add(g.grade.toUpperCase());
    if (!Number.isFinite(g.points) || g.points < 0) errs.push(`Grade "${g.grade}" has invalid points`);
  }
  if (!(scale.grades ?? []).some((g) => g.counts !== false)) errs.push('At least one grade must count');
  return errs;
}
