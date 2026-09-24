export interface Basket {
  id: string;
  name: string;
  requiredCredits: number;
  /** Exact course codes, or patterns with `*` wildcards (e.g. `OE*`). Case-insensitive. */
  courses: string[];
}

export interface Curriculum {
  name: string;
  totalCredits?: number;
  baskets: Basket[];
}

export interface CreditedCourse {
  code: string;
  credits: number;
}

export interface BasketProgress {
  basket: Basket;
  completed: number;
  planned: number;
  /** completed + planned */
  after: number;
  remainingBefore: number;
  remainingAfter: number;
  completedCourses: string[];
  plannedCourses: string[];
}

export interface Progress {
  baskets: BasketProgress[];
  /** Planned course codes that match no basket. */
  unknownPlanned: string[];
  /** Completed course codes that match no basket. */
  unknownCompleted: string[];
  /** Planned courses the student has already completed. */
  alreadyCompleted: string[];
  totalCompleted: number;
  totalAfter: number;
}

const norm = (s: string) => s.trim().toUpperCase();

function globToRegex(pattern: string): RegExp {
  const esc = norm(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`);
}

/**
 * Which basket a course counts toward. Exact code listings win over wildcard patterns;
 * among equals, the basket listed first in the config wins. Each course counts once.
 */
export function basketFor(curriculum: Curriculum, code: string): Basket | null {
  const c = norm(code);
  for (const b of curriculum.baskets) if (b.courses.some((p) => !p.includes('*') && norm(p) === c)) return b;
  for (const b of curriculum.baskets) if (b.courses.some((p) => p.includes('*') && globToRegex(p).test(c))) return b;
  return null;
}

export function computeProgress(
  curriculum: Curriculum,
  completed: readonly CreditedCourse[],
  planned: readonly CreditedCourse[],
): Progress {
  const rows = new Map<string, BasketProgress>(
    curriculum.baskets.map((b) => [
      b.id,
      { basket: b, completed: 0, planned: 0, after: 0, remainingBefore: 0, remainingAfter: 0, completedCourses: [], plannedCourses: [] },
    ]),
  );
  const unknownCompleted: string[] = [];
  const unknownPlanned: string[] = [];
  const alreadyCompleted: string[] = [];
  const done = new Set<string>();

  for (const c of completed) {
    const code = norm(c.code);
    if (done.has(code)) continue;
    done.add(code);
    const b = basketFor(curriculum, code);
    if (!b) unknownCompleted.push(code);
    else {
      const r = rows.get(b.id)!;
      r.completed += c.credits;
      r.completedCourses.push(code);
    }
  }
  const seenPlanned = new Set<string>();
  for (const c of planned) {
    const code = norm(c.code);
    if (seenPlanned.has(code)) continue;
    seenPlanned.add(code);
    if (done.has(code)) {
      alreadyCompleted.push(code);
      continue;
    }
    const b = basketFor(curriculum, code);
    if (!b) unknownPlanned.push(code);
    else {
      const r = rows.get(b.id)!;
      r.planned += c.credits;
      r.plannedCourses.push(code);
    }
  }
  let totalCompleted = 0;
  let totalAfter = 0;
  for (const r of rows.values()) {
    r.after = r.completed + r.planned;
    r.remainingBefore = Math.max(0, r.basket.requiredCredits - r.completed);
    r.remainingAfter = Math.max(0, r.basket.requiredCredits - r.after);
    totalCompleted += r.completed;
    totalAfter += r.after;
  }
  return { baskets: [...rows.values()], unknownPlanned, unknownCompleted, alreadyCompleted, totalCompleted, totalAfter };
}

/** Structural validation of an uploaded curriculum JSON. Returns error messages (empty = valid). */
export function validateCurriculum(x: unknown): string[] {
  const errs: string[] = [];
  const o = x as Partial<Curriculum> | null;
  if (!o || typeof o !== 'object') return ['Curriculum must be a JSON object'];
  if (typeof o.name !== 'string') errs.push('"name" must be a string');
  if (o.totalCredits !== undefined && typeof o.totalCredits !== 'number') errs.push('"totalCredits" must be a number');
  if (!Array.isArray(o.baskets)) return [...errs, '"baskets" must be an array'];
  const ids = new Set<string>();
  o.baskets.forEach((b, i) => {
    const at = `baskets[${i}]`;
    if (typeof b?.id !== 'string' || !b.id) errs.push(`${at}.id must be a non-empty string`);
    else if (ids.has(b.id)) errs.push(`${at}.id "${b.id}" is duplicated`);
    else ids.add(b.id);
    if (typeof b?.name !== 'string') errs.push(`${at}.name must be a string`);
    if (typeof b?.requiredCredits !== 'number' || b.requiredCredits < 0) errs.push(`${at}.requiredCredits must be a number ≥ 0`);
    if (!Array.isArray(b?.courses) || b.courses.some((c) => typeof c !== 'string'))
      errs.push(`${at}.courses must be an array of strings`);
  });
  return errs;
}
