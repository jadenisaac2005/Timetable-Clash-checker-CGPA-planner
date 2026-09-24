import type { Course, Section, Timetable } from '../core/model';
import { ImportError, parseCanonicalCsv, parseSlotMap } from '../import/canonical';
import { loadState, saveState, type AppState } from '../state';

export interface Parsed extends Timetable {
  errors: string[];
  fatal: string | null;
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
    const key = `${tt.csv}\u0000${tt.slotMapCsv ?? ''}`;
    if (key !== this.parseKey) {
      this.parseKey = key;
      this.parsedCache = parse(tt.csv, tt.slotMapCsv);
    }
    return this.parsedCache;
  }
}

function parse(csv: string, slotMapCsv?: string): Parsed {
  const empty = { courses: [], warnings: [], errors: [], byCode: new Map(), sectionsById: new Map() };
  try {
    let slotMap;
    const errors: string[] = [];
    if (slotMapCsv) {
      const sm = parseSlotMap(slotMapCsv);
      slotMap = sm.slots;
      errors.push(...sm.errors);
    }
    const t = parseCanonicalCsv(csv, slotMap);
    const sectionsById = new Map<string, Section>();
    for (const c of t.courses) for (const comp of c.components) for (const s of comp.sections) sectionsById.set(s.id, s);
    return { ...t, errors: [...errors, ...t.errors], fatal: null, byCode: new Map(t.courses.map((c) => [c.code, c])), sectionsById };
  } catch (e) {
    return { ...empty, fatal: e instanceof ImportError ? e.message : `Could not read file: ${(e as Error).message}` };
  }
}
