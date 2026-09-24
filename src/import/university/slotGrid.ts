import type { Meeting } from '../../core/model';
import { formatTime, parseDay, parseTime } from '../../core/time';
import type { SlotMap } from '../canonical';

export interface SlotGrid {
  /** Theory slot name → its weekly meetings (e.g. A1 → Mon/Wed/Fri). */
  theory: SlotMap;
  /** Lab slot name → its meeting (L1 and L2 both map to the same 100-minute block). */
  lab: SlotMap;
  notes: string[];
  errors: string[];
}

/** Split "9:00 - 9.50", "9.00 AM – 10:40 AM", "12.35 - 1.15" into two raw times. */
function splitRange(cell: string): [string, string] | null {
  const parts = cell.split(/\s*[-–—]\s*/).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

const hasSuffix = (s: string) => /[ap]\.?\s*m\.?\s*$/i.test(s.trim());

/**
 * Parse the time row of the grid. Times without AM/PM (the theory row writes "1.15 – 2.05")
 * are resolved by order: a row runs forward through one day, so a time that would fall before
 * the previous one is read as PM. Anything still out of order is an error, never adjusted.
 */
function parseTimeRow(row: string[], startCol: number, label: string, notes: string[], errors: string[]) {
  const out: ({ start: number; end: number } | null)[] = [];
  let last = 0;
  let adjusted = 0;
  const read = (raw: string): number | null => {
    let t = parseTime(raw);
    if (t === null) return null;
    if (!hasSuffix(raw) && t < last && t + 720 >= last && t < 12 * 60) {
      t += 720;
      adjusted++;
    }
    return t;
  };
  for (let c = 0; c < row.length; c++) {
    if (c < startCol) {
      out.push(null);
      continue;
    }
    const range = splitRange(row[c]);
    if (!range) {
      out.push(null);
      if (row[c].trim()) errors.push(`${label}, column ${c + 1}: cannot read time range "${row[c]}"`);
      continue;
    }
    const s = read(range[0]);
    const e = s === null ? null : read(range[1]);
    if (s === null || e === null || e <= s || s < last) {
      errors.push(`${label}, column ${c + 1}: time range "${row[c]}" is unreadable or out of order`);
      out.push(null);
      continue;
    }
    // Same range repeated across a horizontally merged cell: don't treat as going backwards.
    last = Math.max(last, s);
    out.push({ start: s, end: e });
    last = e;
    if (c + 1 < row.length && row[c + 1] === row[c]) last = s;
  }
  if (adjusted) notes.push(`${label}: ${adjusted} time(s) written without AM/PM were read as PM because they follow later times in the same row`);
  return out;
}

/** Parse the slot grid table (first table of the university's "Slot Timetable" document). */
export function parseSlotGrid(table: string[][]): SlotGrid {
  const notes: string[] = [];
  const errors: string[] = [];
  const theory: SlotMap = new Map();
  const lab: SlotMap = new Map();
  const find = (re: RegExp) => table.find((r) => re.test(r[0] ?? ''));
  const theoryRow = find(/^theory\s*hours?$/i);
  const labRow = find(/^lab\s*hours?$/i);
  if (!theoryRow || !labRow) {
    errors.push('Slot grid: could not find the "Theory Hours" and "Lab Hours" rows');
    return { theory, lab, notes, errors };
  }
  // Header cells span the day and kind columns ("Theory Hours" has gridSpan 2) — times start after them.
  const firstTimeCol = (r: string[]) => r.findIndex((c, i) => i > 0 && c !== r[0]);
  const theoryTimes = parseTimeRow(theoryRow, firstTimeCol(theoryRow), 'Theory Hours row', notes, errors);
  const labTimes = parseTimeRow(labRow, firstTimeCol(labRow), 'Lab Hours row', notes, errors);

  for (const row of table) {
    const day = parseDay(row[0] ?? '');
    const kind = (row[1] ?? '').trim().toLowerCase();
    if (!day || (kind !== 'theory' && kind !== 'lab')) continue;
    const times = kind === 'theory' ? theoryTimes : labTimes;
    const target = kind === 'theory' ? theory : lab;
    for (let c = 2; c < row.length; c++) {
      const name = row[c].trim().toUpperCase();
      if (!name || /^lunch$/i.test(name)) continue;
      const t = times[c];
      if (!t) {
        errors.push(`Slot grid: no ${kind} time for ${name} on ${day} (column ${c + 1})`);
        continue;
      }
      const m: Meeting = { day, start: t.start, end: t.end, slot: name };
      const list = target.get(name) ?? [];
      if (!list.some((x) => x.day === m.day && x.start === m.start)) list.push(m);
      target.set(name, list);
    }
  }
  for (const name of theory.keys()) if (lab.has(name)) errors.push(`Slot grid: ${name} appears as both a theory and a lab slot`);
  // Lab slots come in pairs (L1+L2, …) sharing one block; flag any pair whose times differ.
  for (let n = 1; lab.has(`L${n}`); n += 2) {
    const a = lab.get(`L${n}`)![0];
    const b = lab.get(`L${n + 1}`)?.[0];
    if (!b || a.day !== b.day || a.start !== b.start || a.end !== b.end)
      errors.push(`Slot grid: L${n} and L${n + 1} do not share one lab block`);
  }
  // Cross-check: every lab block should start when a theory period starts on the same grid column.
  const theoryStarts = new Set(theoryTimes.filter(Boolean).map((t) => t!.start));
  for (const t of labTimes) if (t && !theoryStarts.has(t.start)) notes.push(`Lab block starting ${formatTime(t.start)} does not line up with a theory period`);
  return { theory, lab, notes, errors };
}

/** Meetings for a lab pair such as "L3+L4" (both halves share one block, so this is one meeting). */
export function labBlock(grid: SlotGrid, a: number, b: number): Meeting[] | null {
  const x = grid.lab.get(`L${a}`);
  const y = grid.lab.get(`L${b}`);
  if (!x || !y) return null;
  return [...x, ...y].filter((m, i, all) => all.findIndex((o) => o.day === m.day && o.start === m.start && o.end === m.end) === i).map((m) => ({ ...m, slot: `L${a}+L${b}` }));
}
