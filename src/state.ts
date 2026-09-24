import { DEFAULT_SCALE, type GradeScale, type PastSemester } from './core/cgpa';
import type { CreditedCourse, Curriculum } from './core/curriculum';

export interface PlannedGrade {
  code: string;
  credits: number;
  grade: string;
}

export interface AppState {
  version: 1;
  /** Raw source text is stored and re-parsed on load, so parser fixes apply to saved plans. */
  timetable: { csv: string; fileName: string; slotMapCsv?: string; slotMapName?: string } | null;
  selected: string[];
  unavailable: string[];
  /** Section ids of the combination the student picked to view/export. */
  chosen: string[] | null;
  maxCredits: number;
  sortBy: 'default' | 'days' | 'gaps' | 'start' | 'end';
  curriculum: Curriculum | null;
  completed: CreditedCourse[];
  cgpa: {
    scale: GradeScale;
    past: PastSemester[];
    target: number | null;
    /** Credits left in the whole programme after the past semesters (incl. the planned one). */
    remainingCredits: number | null;
    planned: PlannedGrade[];
  };
}

export const STORAGE_KEY = 'tccp.plan.v1';

export function defaultState(): AppState {
  return {
    version: 1,
    timetable: null,
    selected: [],
    unavailable: [],
    chosen: null,
    maxCredits: 26,
    sortBy: 'default',
    curriculum: null,
    completed: [],
    cgpa: { scale: structuredClone(DEFAULT_SCALE), past: [], target: null, remainingCredits: null, planned: [] },
  };
}

/** Merge an untrusted object onto defaults, keeping only fields of the right shape. */
export function normalizeState(raw: unknown): AppState {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<AppState>;
  if (r.version !== 1) throw new Error('Unsupported plan file version');
  const arr = <T>(x: unknown, fallback: T[]): T[] => (Array.isArray(x) ? (x as T[]) : fallback);
  const tt = r.timetable;
  return {
    version: 1,
    timetable:
      tt && typeof tt.csv === 'string'
        ? { csv: tt.csv, fileName: String(tt.fileName ?? 'timetable.csv'), slotMapCsv: typeof tt.slotMapCsv === 'string' ? tt.slotMapCsv : undefined, slotMapName: tt.slotMapName }
        : null,
    selected: arr<string>(r.selected, []).filter((x) => typeof x === 'string'),
    unavailable: arr<string>(r.unavailable, []).filter((x) => typeof x === 'string'),
    chosen: Array.isArray(r.chosen) ? r.chosen.filter((x) => typeof x === 'string') : null,
    maxCredits: typeof r.maxCredits === 'number' ? r.maxCredits : d.maxCredits,
    sortBy: ['default', 'days', 'gaps', 'start', 'end'].includes(r.sortBy as string) ? r.sortBy! : 'default',
    curriculum: r.curriculum && typeof r.curriculum === 'object' ? r.curriculum : null,
    completed: arr<CreditedCourse>(r.completed, []).filter((c) => c && typeof c.code === 'string' && typeof c.credits === 'number'),
    cgpa: {
      scale: r.cgpa?.scale && Array.isArray(r.cgpa.scale.grades) ? r.cgpa.scale : d.cgpa.scale,
      past: arr<PastSemester>(r.cgpa?.past, []),
      target: typeof r.cgpa?.target === 'number' ? r.cgpa.target : null,
      remainingCredits: typeof r.cgpa?.remainingCredits === 'number' ? r.cgpa.remainingCredits : null,
      planned: arr<PlannedGrade>(r.cgpa?.planned, []),
    },
  };
}

export function loadState(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): AppState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

/** Returns false if storage is unavailable or full; the app keeps working in memory. */
export function saveState(s: AppState, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
    return !!storage;
  } catch {
    return false;
  }
}
