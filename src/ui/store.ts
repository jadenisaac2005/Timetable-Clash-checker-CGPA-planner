import type { Course, Section, Timetable } from '../core/model';
import { ImportError, parseCanonicalCsv, parseSlotMap } from '../import/canonical';
import { parseSlotGrid } from '../import/university/slotGrid';
import { FALL_2026_27_SLOT_TABLE } from '../import/university/fall2026Grid';
import { parseRegistrationRows, type ImportStats } from '../import/university/registration';
import type { TimetableSource } from '../state';
import { loadState, saveState, type AppState } from '../state';

export interface Parsed extends Timetable {
  errors: string[];
  fatal: string | null;
  /** Row-level statistics (university registration file only). */
  stats?: ImportStats;
  /** Notes from reading the slot grid (e.g. how 12-hour times were resolved). */
  gridNotes?: string[];
  byCode: Map<string, Course>;
  sectionsById: Map<string, Section>;
}

export class Store {
  state: AppState = loadState();
  persisted = true;
  private parseKey: string | null = null;
  private parsedCache: Parsed | null = null;
  private listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  update(fn: (s: AppState) => void) {
    fn(this.state);
    this.persisted = saveState(this.state);
    this.listeners.forEach((l) => l());
  }

  replace(s: AppState) {
    this.update(() => void (this.state = s));
  }

  get parsed(): Parsed | null {
    const tt = this.state.timetable;
    if (!tt) return null;
    const key = tt.kind === 'university' ? `u\u0000${JSON.stringify(tt.rows)}\u0000${JSON.stringify(tt.gridRows ?? null)}` : `c\u0000${tt.csv}\u0000${tt.slotMapCsv ?? ''}`;
    if (key !== this.parseKey) {
      this.parseKey = key;
      this.parsedCache = parse(tt);
    }
    return this.parsedCache;
  }
}

function index(t: { courses: Course[] }) {
  const sectionsById = new Map<string, Section>();
  for (const c of t.courses) for (const comp of c.components) for (const s of comp.sections) sectionsById.set(s.id, s);
  return { byCode: new Map(t.courses.map((c) => [c.code, c])), sectionsById };
}

function parse(tt: TimetableSource): Parsed {
  const empty = { courses: [], warnings: [], errors: [], byCode: new Map(), sectionsById: new Map() };
  if (tt.kind === 'university') {
    const grid = parseSlotGrid(tt.gridRows ?? FALL_2026_27_SLOT_TABLE);
    const r = parseRegistrationRows(tt.rows, grid);
    return { ...r, fatal: r.stats.dataRows ? null : 'No course rows found. Is this the course registration file?', gridNotes: grid.notes, ...index(r) };
  }
  const { csv, slotMapCsv } = tt;
  try {
    let slotMap;
    const errors: string[] = [];
    if (slotMapCsv) {
      const sm = parseSlotMap(slotMapCsv);
      slotMap = sm.slots;
      errors.push(...sm.errors);
    }
    const t = parseCanonicalCsv(csv, slotMap);
    return { ...t, errors: [...errors, ...t.errors], fatal: null, ...index(t) };
  } catch (e) {
    return { ...empty, fatal: e instanceof ImportError ? e.message : `Could not read file: ${(e as Error).message}` };
  }
}
