import { sectionId, type Course, type CourseType, type Meeting, type Section, type Timetable } from '../core/model';
import { parseDay, parseTime } from '../core/time';
import { csvRecords } from './csv';

export type SlotMap = Map<string, Meeting[]>;

const COURSE_TYPES: CourseType[] = ['theory', 'lab', 'tel', 'project'];

export class ImportError extends Error {}

function parseMeeting(day: string, start: string, end: string, where: string, errors: string[], slot?: string): Meeting | null {
  const d = parseDay(day);
  const s = parseTime(start);
  const e = parseTime(end);
  if (!d) errors.push(`${where}: unknown day "${day}"`);
  if (s === null) errors.push(`${where}: cannot read start time "${start}"`);
  if (e === null) errors.push(`${where}: cannot read end time "${end}"`);
  if (!d || s === null || e === null) return null;
  if (e <= s) {
    errors.push(`${where}: end ${end} is not after start ${start}`);
    return null;
  }
  return { day: d, start: s, end: e, slot };
}

/** Slot map CSV: slot,day,start,end — several rows per slot for multi-day slots. */
export function parseSlotMap(text: string): { slots: SlotMap; errors: string[] } {
  const { headers, records } = csvRecords(text);
  const errors: string[] = [];
  for (const h of ['slot', 'day', 'start', 'end'])
    if (!headers.includes(h)) throw new ImportError(`Slot map is missing column "${h}". Expected: slot,day,start,end`);
  const slots: SlotMap = new Map();
  records.forEach((r, i) => {
    const m = parseMeeting(r.day, r.start, r.end, `slot map row ${i + 2}`, errors, r.slot);
    if (m) slots.set(r.slot.toUpperCase(), [...(slots.get(r.slot.toUpperCase()) ?? []), m]);
  });
  return { slots, errors };
}

/**
 * Parse the canonical timetable CSV described in FORMAT.md.
 * Throws ImportError on a structural problem; row-level problems are collected in `errors`
 * (the offending row is skipped, never guessed).
 */
export function parseCanonicalCsv(text: string, slotMap?: SlotMap): Timetable & { errors: string[] } {
  const { headers, records } = csvRecords(text);
  for (const h of ['course_code', 'section'])
    if (!headers.includes(h)) throw new ImportError(`Timetable CSV is missing required column "${h}". See FORMAT.md.`);
  const errors: string[] = [];
  const warnings: string[] = [];

  interface Acc {
    code: string;
    title: string;
    credits: number | null;
    type: CourseType | null;
    components: Map<string, Map<string, Section>>;
  }
  const courses = new Map<string, Acc>();

  records.forEach((r, i) => {
    const where = `row ${i + 2}`;
    const code = r.course_code?.toUpperCase();
    const section = r.section;
    if (!code || !section) {
      errors.push(`${where}: course_code and section are required`);
      return;
    }
    let acc = courses.get(code);
    if (!acc) {
      acc = { code, title: '', credits: null, type: null, components: new Map() };
      courses.set(code, acc);
    }
    if (r.course_title && !acc.title) acc.title = r.course_title;
    if (r.credits) {
      const cr = Number(r.credits);
      if (!Number.isFinite(cr) || cr < 0) errors.push(`${where}: invalid credits "${r.credits}"`);
      else if (acc.credits !== null && acc.credits !== cr)
        warnings.push(`${code}: conflicting credits ${acc.credits} and ${cr}; using ${acc.credits}`);
      else acc.credits = cr;
    }
    if (r.course_type) {
      const t = r.course_type.toLowerCase() as CourseType;
      if (!COURSE_TYPES.includes(t)) warnings.push(`${where}: unknown course_type "${r.course_type}" ignored`);
      else acc.type ??= t;
    }

    const component = r.component || 'main';
    const comp = acc.components.get(component) ?? new Map<string, Section>();
    acc.components.set(component, comp);
    let sec = comp.get(section);
    if (!sec) {
      sec = { id: sectionId(code, component, section), courseCode: code, component, section, slots: [], meetings: [] };
      comp.set(section, sec);
    }
    if (r.faculty && !sec.faculty) sec.faculty = r.faculty;
    if (r.room && !sec.room) sec.room = r.room;
    const slot = r.slot?.toUpperCase() || undefined;
    if (slot && !sec.slots.includes(slot)) sec.slots.push(slot);

    // A row whose times cannot be read adds no meetings and marks its section "times unknown",
    // so the section is never reported as clash-free on the strength of the times that remain.
    const unreadable = () => void (sec.timesUnknown ??= 'Some class times in the file could not be read');
    const timeFields = [r.day, r.start, r.end].filter((x) => x);
    if (timeFields.length === 3) {
      const m = parseMeeting(r.day, r.start, r.end, where, errors, slot);
      if (m) sec.meetings.push(m);
      else unreadable();
    } else if (timeFields.length > 0) {
      errors.push(`${where}: day, start and end must all be filled or all be blank`);
      unreadable();
    } else if (slot) {
      if (!slotMap) {
        errors.push(`${where}: slot "${slot}" has no times and no slot map is loaded`);
        unreadable();
        return;
      }
      const parts = slot.split('+').map((p) => p.trim());
      const missing = parts.filter((p) => !slotMap.has(p));
      if (missing.length) {
        for (const part of missing) errors.push(`${where}: slot "${part}" is not in the slot map`);
        unreadable();
      } else for (const part of parts) sec.meetings.push(...slotMap.get(part)!.map((m) => ({ ...m, slot })));
    }
    // No times and no slot: a meeting-less section (project/dissertation). Never clashes.
  });

  const out: Course[] = [];
  for (const acc of courses.values()) {
    if (acc.credits === null) {
      warnings.push(`${acc.code}: no credits given; assuming 0`);
    }
    const components = [...acc.components].map(([name, secs]) => ({ name, sections: [...secs.values()] }));
    for (const comp of components)
      for (const s of comp.sections) {
        s.meetings = dedupeMeetings(s.meetings);
        if (!s.meetings.length && acc.type !== 'project')
          warnings.push(`${s.courseCode} ${s.section}: no class times — treated as never clashing`);
      }
    out.push({
      code: acc.code,
      title: acc.title || acc.code,
      credits: acc.credits ?? 0,
      type: acc.type ?? (components.length > 1 ? 'tel' : 'theory'),
      components,
    });
  }
  out.sort((a, b) => a.code.localeCompare(b.code));
  return { courses: out, warnings, errors };
}

function dedupeMeetings(ms: Meeting[]): Meeting[] {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = `${m.day}|${m.start}|${m.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
