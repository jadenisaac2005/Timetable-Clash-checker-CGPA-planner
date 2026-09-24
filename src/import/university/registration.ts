import { sectionId, type Course, type CourseType, type Meeting, type Section, type Timetable } from '../../core/model';
import { formatMeeting, meetingsOverlap } from '../../core/time';
import { labBlock, type SlotGrid } from './slotGrid';

/**
 * Importer for the university's "Course Registration File" workbook (see FORMAT.md §1).
 * Only course and slot data is read. Faculty names, rooms and other free text in the slot columns
 * are ignored and never copied into the result or its messages.
 * Input is the sheet as a grid of cell strings, so it works the same for .xlsx (via SheetJS)
 * and for a .csv saved from it.
 */

export interface SkippedRow {
  row: number;
  code: string;
  reason: string;
}

export interface Normalization {
  row: number;
  code: string;
  from: string;
  to: string;
  why: string;
  /**
   * high: only the spelling is off and exactly one slot fits (a missing second "L", a hyphen).
   * low: the cell does not say it is a lab slot at all (bare "31+32"); the reading relies on the
   * column it sits in. Sections using a low-confidence reading carry a visible warning.
   */
  confidence: 'high' | 'low';
}

/** A row imported without (all of) its class times because the file does not give them. */
export interface UnknownTimesRow {
  row: number;
  code: string;
  reason: string;
}

export interface ImportStats {
  totalRows: number;
  headerRows: number[];
  headingRows: { row: number; text: string }[];
  blankRows: number;
  /** Rows that carry a course code (i.e. offerings). */
  dataRows: number;
  importedRows: number;
  /** Imported rows whose class times are (partly) missing from the file; subset of importedRows. */
  timesUnknown: UnknownTimesRow[];
  skipped: SkippedRow[];
  normalizations: Normalization[];
}

export interface UniversityImport extends Timetable {
  errors: string[];
  stats: ImportStats;
}

const clean = (v: unknown) =>
  String(v ?? '')
    .replace(/[ \t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CODE_RE = /^[A-Z]{3}\d{4}$/;
/** Two codes in one cell, e.g. "FRE1002/SPA1001" (row 197). Imported as printed, with a warning. */
const COMBINED_CODE_RE = /^[A-Z]{3}\d{4}(\/[A-Z]{3}\d{4})+$/;

/** True if this row is a table header of the registration file. */
export function isRegistrationHeader(cells: string[]): boolean {
  return cells.some((c) => /^course\s*code$/i.test(clean(c))) && cells.some((c) => /^(course\s*(name|title))$/i.test(clean(c)));
}

const SLOT_TOKEN = /(?:[A-Z]{1,2}\d{1,2}|\d{1,2})/.source;
const SLOT_LIKE = new RegExp(`^${SLOT_TOKEN}(?:\\s*[+,&-]\\s*${SLOT_TOKEN})*$`, 'i');

/** Could this cell be a slot expression (in any semester's grid) or the project marker? */
function mayBeSlotCell(text: string): boolean {
  const t = clean(text);
  if (PROJECT_RE.test(t)) return true;
  // Needs a letter-prefixed slot, or a "+"-joined pair of numbers (e.g. "31+32"); a lone "226" is a room.
  return SLOT_LIKE.test(t) && (/[A-Z]/i.test(t) || /\d\s*\+\s*\d/.test(t));
}

/**
 * Copy of the sheet with every cell after the credits column blanked unless it can be a slot.
 * Faculty names, rooms and notes therefore never reach saved plans or exported JSON. The result
 * parses exactly like the original.
 */
export function sanitizeRegistrationRows(rows: string[][]): string[][] {
  let cols: Columns | null = null;
  return rows.map((raw, i) => {
    const cells = raw.map((c) => String(c ?? ''));
    if (isRegistrationHeader(cells)) {
      cols = columnsFrom(cells, i + 1);
      return cells;
    }
    if (!cols || !clean(cells[cols.code] ?? '')) return cells;
    const c: Columns = cols;
    return cells.map((v, j) => (j > c.credits && v && !mayBeSlotCell(v) ? '' : v));
  });
}

/** Quick check used to route an uploaded sheet to this importer rather than the canonical CSV one. */
export function looksLikeRegistrationFile(rows: string[][]): boolean {
  return rows.slice(0, 30).some((r) => isRegistrationHeader(r) && r.some((c) => /slot/i.test(c)));
}

interface Columns {
  headerRow: number;
  labels: string[];
  code: number;
  title: number;
  theoryHours: number;
  practicalHours: number;
  credits: number;
  category: number;
}

function columnsFrom(cells: string[], row: number): Columns {
  const labels = cells.map(clean);
  const idx = (re: RegExp) => labels.findIndex((l) => re.test(l));
  return {
    headerRow: row,
    labels,
    code: idx(/^course\s*code$/i),
    title: idx(/^course\s*(name|title)$/i),
    theoryHours: idx(/^[LT]$/i),
    practicalHours: idx(/^P$/i),
    credits: idx(/^C$/i),
    category: idx(/^(course\s*category|program)$/i),
  };
}

type Cell =
  | { kind: 'theory'; slots: string[] }
  | { kind: 'lab'; pairs: [number, number][]; normalized: { from: string; to: string; why: string; confidence: 'high' | 'low' }[] }
  | { kind: 'project'; text: string }
  /** Anything else (faculty names, rooms, notes). Ignored: never stored, shown or quoted. */
  | { kind: 'other' };

const PROJECT_RE = /project\s*based|no\s*slots?\s*(are\s*)?required/i;

function classify(text: string, grid: SlotGrid): Cell {
  if (PROJECT_RE.test(text)) return { kind: 'project', text };
  const compact = text.replace(/\s+/g, '').toUpperCase();
  const theoryTokens = compact.split('+');
  if (theoryTokens.every((t) => grid.theory.has(t))) return { kind: 'theory', slots: theoryTokens };
  const lab = classifyLab(text, grid);
  return lab ?? { kind: 'other' };
}

/**
 * Lab cells hold one or more 100-minute blocks, each a pair "L<odd>+L<odd+1>", separated by
 * "," or "&". Only spellings with exactly one possible reading are accepted, and every one that
 * is not written exactly that way is recorded as a normalization:
 *   "L15+16" / "L35 +36" (second L missing), "31+32" (both missing, but in a lab-slot cell
 *   and there is no theory slot named 31), "L21-L22" (hyphen between the two halves).
 * Anything else (odd pairings, numbers outside the grid) is rejected.
 */
function classifyLab(text: string, grid: SlotGrid): Cell | null {
  const blocks = text.split(/\s*[,&]\s*/).filter(Boolean);
  if (!blocks.length) return null;
  const pairs: [number, number][] = [];
  const normalized: { from: string; to: string; why: string; confidence: 'high' | 'low' }[] = [];
  for (const raw of blocks) {
    const b = raw.replace(/\s+/g, '').toUpperCase();
    let m = /^L(\d{1,2})\+L(\d{1,2})$/.exec(b);
    let why = '';
    let confidence: 'high' | 'low' = 'high';
    if (!m && (m = /^L(\d{1,2})\+(\d{1,2})$/.exec(b))) why = 'second "L" missing';
    else if (!m && (m = /^(\d{1,2})\+(\d{1,2})$/.exec(b))) {
      why = '"L" prefixes missing; read as a lab slot only because of the column it is in';
      confidence = 'low';
    } else if (!m && (m = /^L(\d{1,2})-L?(\d{1,2})$/.exec(b))) why = 'hyphen instead of "+"';
    if (!m) return null;
    const a = Number(m[1]);
    const c = Number(m[2]);
    if (a % 2 !== 1 || c !== a + 1 || !grid.lab.has(`L${a}`) || !grid.lab.has(`L${c}`)) return null;
    pairs.push([a, c]);
    if (why) normalized.push({ from: raw.trim(), to: `L${a}+L${c}`, why, confidence });
  }
  return { kind: 'lab', pairs, normalized };
}

const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Offering {
  row: number;
  code: string;
  title: string;
  theoryHours: number;
  practicalHours: number;
  credits: number;
  category: string;
  audience: string;
  theory: string[];
  labs: [number, number][];
  project: boolean;
  meetings: Meeting[];
  timesUnknown?: string;
  warnings: string[];
}

export function parseRegistrationRows(rows: string[][], grid: SlotGrid): UniversityImport {
  const errors: string[] = [...grid.errors];
  const warnings: string[] = [];
  const stats: ImportStats = { totalRows: rows.length, headerRows: [], headingRows: [], blankRows: 0, dataRows: 0, importedRows: 0, timesUnknown: [], skipped: [], normalizations: [] };
  const offerings: Offering[] = [];
  let cols: Columns | null = null;
  let audience = '';
  const columnNotes = new Map<string, string>();

  rows.forEach((raw, i) => {
    const rowNum = i + 1;
    const cells = raw.map(clean);
    if (cells.every((c) => c === '')) {
      stats.blankRows++;
      return;
    }
    if (isRegistrationHeader(cells)) {
      cols = columnsFrom(cells, rowNum);
      stats.headerRows.push(rowNum);
      audience = '';
      return;
    }
    const code = cols ? cells[cols.code].toUpperCase().replace(/\s+/g, '') : '';
    if (!cols || !code) {
      // Sub-heading such as "M.Tech 2nd year" (no course code on the row).
      const text = cells.filter(Boolean).join(' ');
      stats.headingRows.push({ row: rowNum, text });
      if (cols) audience = text;
      return;
    }
    const c: Columns = cols;
    stats.dataRows++;
    const skip = (reason: string) => stats.skipped.push({ row: rowNum, code, reason });

    const num = (col: number, name: string) => {
      const v = col >= 0 ? cells[col] : '';
      const n = Number(v);
      if (v === '' || !Number.isFinite(n)) {
        warnings.push(`Row ${rowNum} ${code}: ${name} "${v}" is not a number; using 0`);
        return 0;
      }
      return n;
    };
    const theoryHours = num(c.theoryHours, c.labels[c.theoryHours] ?? 'L/T');
    const practicalHours = num(c.practicalHours, 'P');
    const credits = num(c.credits, 'C');

    const found: Cell[] = [];
    for (let col = c.credits + 1; col < cells.length; col++) {
      if (!cells[col]) continue;
      const cell = classify(cells[col], grid);
      found.push(cell);
      const label = c.labels[col] || `column ${col + 1}`;
      if ((cell.kind === 'lab' && /theory/i.test(label)) || (cell.kind === 'theory' && /lab/i.test(label)) || ((cell.kind === 'lab' || cell.kind === 'theory') && /venue|faculty/i.test(label)))
      {
        const key = `${c.headerRow}|${col}|${cell.kind}`;
        if (!columnNotes.has(key))
          columnNotes.set(key, `Table starting at row ${c.headerRow}: column "${label}" contains ${cell.kind} slots (first at row ${rowNum}: "${cells[col]}"); slots are read by their content, not by the header`);
      }
    }
    const theoryCells = found.filter((f): f is Extract<Cell, { kind: 'theory' }> => f.kind === 'theory');
    const labCells = found.filter((f): f is Extract<Cell, { kind: 'lab' }> => f.kind === 'lab');
    const project = found.some((f) => f.kind === 'project');

    if (!CODE_RE.test(code) && !COMBINED_CODE_RE.test(code)) return skip(`course code "${cells[c.code]}" is not a course code`);
    if (COMBINED_CODE_RE.test(code)) warnings.push(`Row ${rowNum}: "${code}" names more than one course in one cell; imported as printed`);
    if (theoryCells.length > 1 || labCells.length > 1) return skip('more than one theory or lab slot cell on the row');
    const theory = theoryCells[0]?.slots ?? [];
    const labs = labCells[0]?.pairs ?? [];

    // Times the file does not give are never guessed: the row is imported as "times unknown",
    // keeping whatever times it does give. Only an explicit project marker means "no classes".
    const tLabel = c.labels[c.theoryHours] || 'L/T';
    let timesUnknown: string | undefined;
    if (!project && !theory.length && !labs.length) timesUnknown = 'No slot in the registration file';
    else if (!project && !theory.length && theoryHours > 0)
      timesUnknown = `Theory slot not given in the registration file (${tLabel}=${theoryHours}); only the lab time is known`;
    else if (!project && !labs.length && practicalHours > 0)
      timesUnknown = `Lab slot not given in the registration file (P=${practicalHours}); only the theory time is known`;
    if (timesUnknown) stats.timesUnknown.push({ row: rowNum, code, reason: timesUnknown });

    const rowWarnings: string[] = [];
    for (const n of labCells[0]?.normalized ?? []) {
      stats.normalizations.push({ row: rowNum, code, ...n });
      if (n.confidence === 'low') rowWarnings.push(`Row ${rowNum}: lab slot written "${n.from}" was read as ${n.to} (low confidence) — verify on the portal`);
    }

    const meetings: Meeting[] = [];
    for (const t of theory) meetings.push(...grid.theory.get(t)!.map((m) => ({ ...m, slot: t })));
    for (const [a, b] of labs) meetings.push(...labBlock(grid, a, b)!);

    if (!project && !timesUnknown) {
      const theoryMeetings = meetings.filter((m) => !m.slot?.startsWith('L')).length;
      if (theory.length && theoryMeetings !== theoryHours)
        warnings.push(`Row ${rowNum} ${code}: theory slot ${theory.join('+')} meets ${theoryMeetings}×/week but ${c.labels[c.theoryHours]}=${theoryHours}`);
      if (labs.length && labs.length * 2 !== practicalHours)
        warnings.push(`Row ${rowNum} ${code}: ${labs.length} lab block(s) of 100 min but P=${practicalHours}`);
      for (let x = 0; x < meetings.length; x++)
        for (let y = x + 1; y < meetings.length; y++)
          if (meetingsOverlap(meetings[x], meetings[y]))
            warnings.push(`Row ${rowNum} ${code}: its own slots overlap (${meetings[x].slot} ${formatMeeting(meetings[x])} and ${meetings[y].slot})`);
    }
    offerings.push({
      row: rowNum,
      code,
      title: cells[c.title] ?? '',
      theoryHours,
      practicalHours,
      credits,
      category: c.category >= 0 ? cells[c.category] : '',
      audience,
      theory,
      labs,
      project,
      meetings: project ? [] : meetings,
      timesUnknown,
      warnings: rowWarnings,
    });
    stats.importedRows++;
  });
  warnings.unshift(...columnNotes.values());

  // Same code printed with different titles = different courses; keep them apart and say so.
  const titlesByCode = new Map<string, Set<string>>();
  for (const o of offerings) titlesByCode.set(o.code, (titlesByCode.get(o.code) ?? new Set()).add(titleKey(o.title)));
  const keyOf = (o: Offering) => ((titlesByCode.get(o.code)?.size ?? 0) > 1 ? `${o.code} [${o.title}]` : o.code);
  for (const [code, titles] of titlesByCode)
    if (titles.size > 1) {
      const rowsFor = offerings.filter((o) => o.code === code);
      warnings.push(`${code} appears with ${titles.size} different titles (${rowsFor.map((o) => `row ${o.row}: "${o.title}"`).join('; ')}); kept as separate courses`);
    }

  const courses = new Map<string, Course>();
  for (const o of offerings) {
    const key = keyOf(o);
    let course = courses.get(key);
    const hasTheory = o.theory.length > 0 || (!!o.timesUnknown && o.theoryHours > 0);
    const hasLab = o.labs.length > 0 || (!!o.timesUnknown && o.practicalHours > 0);
    const type: CourseType = o.project ? 'project' : hasTheory && hasLab ? 'tel' : hasLab ? 'lab' : 'theory';
    if (!course) {
      course = {
        code: key,
        title: o.title,
        credits: o.credits,
        type,
        components: [{ name: 'main', sections: [] }],
        category: o.category || undefined,
        audience: o.audience || undefined,
        hours: { theory: o.theoryHours, practical: o.practicalHours },
        ...(key !== o.code ? { officialCode: o.code } : {}),
      };
      courses.set(key, course);
    } else {
      if (course.credits !== o.credits || course.hours!.theory !== o.theoryHours || course.hours!.practical !== o.practicalHours)
        warnings.push(`Row ${o.row} ${key}: hours/credits ${o.theoryHours}-${o.practicalHours}-${o.credits} differ from earlier rows (${course.hours!.theory}-${course.hours!.practical}-${course.credits}); using the earlier values`);
      if (o.category && course.category && titleKey(o.category) !== titleKey(course.category) && !course.category.includes(o.category))
        course.category = `${course.category}; ${o.category}`;
    }
    const known = [o.theory.join('+'), o.labs.map(([a, b]) => `L${a}+L${b}`).join(', ')].filter(Boolean).join(' · ');
    const slotLabel = o.project
      ? 'Project (no slot)'
      : !o.timesUnknown
        ? known
        : !known
          ? 'Times unknown'
          : !o.theory.length
            ? `theory slot unknown · ${known}`
            : `${known} · lab slot unknown`;
    const sections = course.components[0].sections;
    let sec = sections.find((s) => s.section === slotLabel);
    if (!sec) {
      sec = {
        id: sectionId(key, 'main', slotLabel),
        courseCode: key,
        component: 'main',
        section: slotLabel,
        slots: [...o.theory, ...o.labs.map(([a, b]) => `L${a}+L${b}`)],
        meetings: o.meetings,
        rows: [],
        ...(o.timesUnknown ? { timesUnknown: o.timesUnknown } : {}),
      } satisfies Section;
      sections.push(sec);
    }
    sec.rows!.push(o.row);
    if (o.warnings.length) sec.warnings = [...(sec.warnings ?? []), ...o.warnings];
  }

  const out = [...courses.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { courses: out, warnings, errors, stats };
}
