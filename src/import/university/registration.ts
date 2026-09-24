import { sectionId, type Course, type CourseType, type Meeting, type Section, type Timetable } from '../../core/model';
import { formatMeeting, meetingsOverlap } from '../../core/time';
import { labBlock, type SlotGrid } from './slotGrid';

/**
 * Importer for the university's "Course Registration File" workbook (see FORMAT.md §1).
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
}

export interface ImportStats {
  totalRows: number;
  headerRows: number[];
  headingRows: { row: number; text: string }[];
  blankRows: number;
  /** Rows that carry a course code (i.e. offerings). */
  dataRows: number;
  importedRows: number;
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

/** True if this row is a table header of the registration file. */
export function isRegistrationHeader(cells: string[]): boolean {
  return cells.some((c) => /^course\s*code$/i.test(clean(c))) && cells.some((c) => /^(course\s*(name|title))$/i.test(clean(c)));
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
  | { kind: 'lab'; pairs: [number, number][]; normalized: { from: string; to: string; why: string }[] }
  | { kind: 'project'; text: string }
  | { kind: 'other'; text: string };

const PROJECT_RE = /project\s*based|no\s*slots?\s*(are\s*)?required/i;

function classify(text: string, grid: SlotGrid): Cell {
  if (PROJECT_RE.test(text)) return { kind: 'project', text };
  const compact = text.replace(/\s+/g, '').toUpperCase();
  const theoryTokens = compact.split('+');
  if (theoryTokens.every((t) => grid.theory.has(t))) return { kind: 'theory', slots: theoryTokens };
  const lab = classifyLab(text, grid);
  return lab ?? { kind: 'other', text };
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
  const normalized: { from: string; to: string; why: string }[] = [];
  for (const raw of blocks) {
    const b = raw.replace(/\s+/g, '').toUpperCase();
    let m = /^L(\d{1,2})\+L(\d{1,2})$/.exec(b);
    let why = '';
    if (!m && (m = /^L(\d{1,2})\+(\d{1,2})$/.exec(b))) why = 'second "L" missing';
    else if (!m && (m = /^(\d{1,2})\+(\d{1,2})$/.exec(b))) why = '"L" prefixes missing';
    else if (!m && (m = /^L(\d{1,2})-L?(\d{1,2})$/.exec(b))) why = 'hyphen instead of "+"';
    if (!m) return null;
    const a = Number(m[1]);
    const c = Number(m[2]);
    if (a % 2 !== 1 || c !== a + 1 || !grid.lab.has(`L${a}`) || !grid.lab.has(`L${c}`)) return null;
    pairs.push([a, c]);
    if (why) normalized.push({ from: raw.trim(), to: `L${a}+L${c}`, why });
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
  faculty: string[];
}

export function parseRegistrationRows(rows: string[][], grid: SlotGrid): UniversityImport {
  const errors: string[] = [...grid.errors];
  const warnings: string[] = [];
  const stats: ImportStats = { totalRows: rows.length, headerRows: [], headingRows: [], blankRows: 0, dataRows: 0, importedRows: 0, skipped: [], normalizations: [] };
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
    const other = found.filter((f): f is Extract<Cell, { kind: 'other' }> => f.kind === 'other').map((f) => f.text);

    if (!CODE_RE.test(code))
      return skip(`course code "${cells[c.code]}" is not a single course code${!project && !theoryCells.length && !labCells.length ? ', and no slot is given' : ''}`);
    if (theoryCells.length > 1 || labCells.length > 1) return skip('more than one theory or lab slot cell on the row');
    const theory = theoryCells[0]?.slots ?? [];
    const labs = labCells[0]?.pairs ?? [];
    if (!project && !theory.length && !labs.length)
      return skip(other.length ? `no recognisable slot (found ${other.map((o) => `"${o}"`).join(', ')})` : 'no slot given and not marked as a project course');
    if (!project && !theory.length && theoryHours > 0) return skip(`theory slot is blank but ${c.labels[c.theoryHours]}=${theoryHours}, so its class times are unknown`);
    if (!project && !labs.length && practicalHours > 0) return skip(`lab slot is blank but P=${practicalHours}, so its lab times are unknown`);

    for (const n of labCells[0]?.normalized ?? []) stats.normalizations.push({ row: rowNum, code, ...n });

    const meetings: Meeting[] = [];
    for (const t of theory) meetings.push(...grid.theory.get(t)!.map((m) => ({ ...m, slot: t })));
    for (const [a, b] of labs) meetings.push(...labBlock(grid, a, b)!);

    if (!project) {
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
      faculty: other.filter((o) => !/^\d+$/.test(o) && !/^open elective$/i.test(o)),
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
    const type: CourseType = o.project ? 'project' : o.theory.length && o.labs.length ? 'tel' : o.labs.length ? 'lab' : 'theory';
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
    const slotLabel = o.project ? 'Project (no slot)' : [o.theory.join('+'), o.labs.map(([a, b]) => `L${a}+L${b}`).join(', ')].filter(Boolean).join(' · ');
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
      } satisfies Section;
      sections.push(sec);
    }
    sec.rows!.push(o.row);
    const fac = new Set([...(sec.faculty ? sec.faculty.split('; ') : []), ...o.faculty]);
    if (fac.size) sec.faculty = [...fac].join('; ');
  }

  const out = [...courses.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { courses: out, warnings, errors, stats };
}
