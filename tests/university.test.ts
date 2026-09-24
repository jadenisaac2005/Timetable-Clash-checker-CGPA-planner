import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbookRows } from '../src/import/xlsx';
import { parseSlotGrid } from '../src/import/university/slotGrid';
import { FALL_2026_27_SLOT_TABLE } from '../src/import/university/fall2026Grid';
import { parseRegistrationRows, looksLikeRegistrationFile, sanitizeRegistrationRows, type UniversityImport } from '../src/import/university/registration';
import { loadTimetableFile } from '../src/import/load';
import { sectionClash } from '../src/core/clash';
import { solve } from '../src/core/solver';
import { formatMeeting } from '../src/core/time';
import { officialCode, type Section } from '../src/core/model';
import { computeProgress } from '../src/core/curriculum';
import { comboText, sectionCaveats } from '../src/export';

const XLSX_PATH = new URL('../data/Course_Registration_File_for_the_academic_year_2026_-Fall_Semester_-Student_Copy.xlsx', import.meta.url);
const grid = parseSlotGrid(FALL_2026_27_SLOT_TABLE);

let rows: string[][];
let r: UniversityImport;
beforeAll(async () => {
  const buf = readFileSync(XLSX_PATH);
  const sheets = await readWorkbookRows(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  expect(sheets.map((s) => s.name)).toEqual(['Student Data']);
  rows = sheets[0].rows;
  r = parseRegistrationRows(rows, grid);
});

const course = (code: string) => r.courses.find((c) => c.code === code)!;
const section = (code: string, label: string): Section => {
  const s = course(code).components[0].sections.find((x) => x.section === label);
  if (!s) throw new Error(`${code} has no section ${label}`);
  return s;
};

describe('Fall 2026-27 registration file (real data/ file)', () => {
  it('is recognised as the university format', () => expect(looksLikeRegistrationFile(rows)).toBe(true));

  it('reads every row and accounts for each one', () => {
    const st = r.stats;
    expect(st.totalRows).toBe(214);
    expect(st.headerRows).toEqual([1, 149, 169, 185, 212]);
    expect(st.headingRows.map((h) => h.row)).toEqual([125, 133, 141]);
    expect(st.blankRows).toBe(3);
    expect(st.dataRows).toBe(203);
    expect(st.importedRows).toBe(203);
    expect(st.skipped).toEqual([]);
    expect(st.timesUnknown).toHaveLength(26);
    expect(st.headerRows.length + st.headingRows.length + st.blankRows + st.dataRows).toBe(st.totalRows);
    expect(st.importedRows + st.skipped.length).toBe(st.dataRows);
    expect(r.errors).toEqual([]);
    // 58 courses with known times + KAN1004, FRE1002, FRE1002/SPA1001, POS1044, POS1045.
    expect(r.courses).toHaveLength(63);
    expect(r.courses.reduce((t, c) => t + c.components[0].sections.length, 0)).toBe(169);
  });

  it('imports rows without times as "times unknown" instead of skipping them', () => {
    const rowsOf = (re: RegExp) => r.stats.timesUnknown.filter((x) => re.test(x.code)).map((x) => x.row);
    expect(rowsOf(/^KAN1004$/)).toEqual([190, 191, 192, 193, 194, 195]);
    expect(rowsOf(/^FRE1002$/)).toEqual([196, 198, 204, 206, 207, 209, 211]);
    expect(rowsOf(/^FRE1002\/SPA1001$/)).toEqual([197, 199, 200, 201, 202, 203, 205, 208, 210]);
    expect(rowsOf(/^POS/)).toEqual([213, 214]);
    expect(rowsOf(/^CSE(2007|1035)$/)).toEqual([38, 52]);
    // Reasons never quote the text found in the slot columns.
    expect(r.stats.timesUnknown.every((x) => !x.reason.includes('"'))).toBe(true);
  });

  it('gives a slotless course one selectable "Times unknown" section with no meetings', () => {
    const kan = course('KAN1004');
    expect(kan.components[0].sections).toHaveLength(1);
    const s = kan.components[0].sections[0];
    expect(s.section).toBe('Times unknown');
    expect(s.rows).toEqual([190, 191, 192, 193, 194, 195]);
    expect(s.meetings).toEqual([]);
    expect(s.timesUnknown).toBe('No slot in the registration file');
    expect(course('FRE1002/SPA1001').title).toBe('French/Spanish');
    expect(r.warnings).toContain('Row 197: "FRE1002/SPA1001" names more than one course in one cell; imported as printed');
  });

  it('keeps the known lab time of a row whose theory slot is blank', () => {
    const s = section('CSE2007', 'theory slot unknown · L33+L34');
    expect(s.rows).toEqual([38]);
    expect(s.meetings.map(formatMeeting)).toEqual(['Thu 13:15–14:55']);
    expect(s.timesUnknown).toMatch(/Theory slot not given .*L=2/);
    // Its known lab still clashes for real: CSE2001 row 30 is C2 + L33+L34.
    expect(sectionClash(s, section('CSE2001', 'C2 · L33+L34'))).not.toBeNull();
  });

  it('lists every corrected slot spelling with its confidence', () => {
    expect(r.stats.normalizations.map((n) => `${n.row}:${n.from}->${n.to}:${n.confidence}`)).toEqual([
      '9:31+32->L31+L32:low',
      '19:L15+16->L15+L16:high',
      '171:L35 +36->L35+L36:high',
      '172:L23 +24->L23+L24:high',
      '173:L19+ 20->L19+L20:high',
      '186:L21-L22->L21+L22:high',
      '187:L11-L12->L11+L12:high',
      '188:L33-L34->L33+L34:high',
      '189:L39-L40->L39+L40:high',
    ]);
  });

  it('puts a visible warning on sections that use a low-confidence reading, and only those', () => {
    const low = section('CSE1017', 'G2 · L23+L24, L31+L32'); // row 9, "31+32"
    expect(low.warnings).toEqual(['Row 9: lab slot written "31+32" was read as L31+L32 (low confidence) — verify on the portal']);
    expect(sectionCaveats(low)).toEqual(['CSE1017: Row 9: lab slot written "31+32" was read as L31+L32 (low confidence) — verify on the portal']);
    expect(comboText([low], r.courses)).toContain('(low-confidence slot reading — verify on the portal)');
    // High-confidence corrections (row 19 "L15+16", rows 186–189 hyphens) carry no warning.
    expect(section('CSE2046', 'F2 · L15+L16').warnings).toBeUndefined();
    expect(section('KAN1005', 'L21+L22').warnings).toBeUndefined();
    const warned = r.courses.flatMap((c) => c.components[0].sections).filter((x) => x.warnings?.length);
    expect(warned.map((x) => x.id)).toEqual([low.id]);
  });

  // Counted by hand from the sheet: distinct (theory slot, lab slots) combinations per course code.
  // CSE1017 rows 2–13: 12 rows, all different.            CSE2046 rows 14–25: rows 17 and 22 are both G2+L15+L16 → 11.
  // CSE2001 rows 26–34: rows 26 and 34 are both A2+L3+L4 → 8. MAT2002 rows 150–162: D1+TA1, C1, C2, B2, E1+TC1, B1, A1 → 7.
  // CSE3003 rows 95–102: A1, B1, C2, A2, C1 → 5.            CSE2007 rows 35–41: 6 + row 38 (theory unknown) → 7.
  // CSE1035 rows 42–52: 10 + row 52 (theory unknown) → 11. SSK3001 rows 175–184: L35+L36 and L39+L40 twice → 8.
  // KAN1005 rows 186–189 → 4.                              ECE3026 row 82 (project) → 1.
  it.each([
    ['CSE1017', 12],
    ['CSE2046', 11],
    ['CSE2001', 8],
    ['MAT2002', 7],
    ['CSE3003', 5],
    ['CSE2007', 7],
    ['CSE1035', 11],
    ['SSK3001', 8],
    ['KAN1005', 4],
    ['ECE3026', 1],
    ['CSE2006', 12],
    ['CSE2009', 8],
  ])('%s has %i sections', (code, n) => expect(course(code).components[0].sections).toHaveLength(n));

  it('merges identical offerings and keeps their source rows', () => {
    expect(section('CSE2001', 'A2 · L3+L4').rows).toEqual([26, 34]);
    expect(section('MAT2002', 'E1+TC1').rows).toEqual([154, 159, 162]);
  });

  it('gives TEL rows both theory and lab meetings (chosen together)', () => {
    const s = section('CSE1017', 'F1 · L25+L26, L39+L40');
    expect(s.meetings.map(formatMeeting)).toEqual(['Mon 09:55–10:45', 'Wed 10:50–11:40', 'Tue 13:15–14:55', 'Fri 15:05–16:45']);
    expect(course('CSE1017').type).toBe('tel');
    expect(course('CSE1017').components).toHaveLength(1);
  });

  it('treats the project course as having no class times', () => {
    const c = course('ECE3026');
    expect(c.type).toBe('project');
    expect(c.components[0].sections[0].meetings).toEqual([]);
  });

  it('keeps the two different ECE3036 courses apart, but exports and matches them by the official code', () => {
    const both = r.courses.filter((c) => c.officialCode === 'ECE3036');
    expect(both.map((c) => c.title)).toEqual(['Robotic System Mechanics', 'System and Network on Chip']);
    const txt = comboText([both[0].components[0].sections[0]], r.courses);
    expect(txt.startsWith('ECE3036\tRobotic System Mechanics\t')).toBe(true);
    const cur = { name: 'c', baskets: [{ id: 'rob', name: 'Robotics', requiredCredits: 3, courses: ['ECE3036'] }] };
    const pr = computeProgress(cur, [], both.map((c) => ({ code: officialCode(c), credits: c.credits })));
    expect(pr.unknownPlanned).toEqual([]);
    expect(pr.baskets[0].planned).toBe(3);
  });

  it('reads slots from mislabelled columns by content', () => {
    // Table at row 169: lab slots sit under "Theory Venue"; its "Lab Slot" column held faculty names.
    const s = section('SSK2002', 'L11+L12');
    expect(s.rows).toEqual([170, 174]);
    expect(r.warnings.some((w) => w.includes('column "Theory Venue" contains lab slots'))).toBe(true);
  });

  it('never stores faculty or other free text from the slot columns', () => {
    const synthetic = rows.map((row, i) => (i === 169 ? row.map((c, j) => (j === 8 ? 'Dr. Example Person' : c)) : row));
    const out = parseRegistrationRows(synthetic, grid);
    const everything = JSON.stringify(out);
    expect(everything).not.toContain('Example Person');
    expect(out.courses.flatMap((c) => c.components[0].sections).every((x) => x.faculty === undefined)).toBe(true);
  });
});

describe('real clashes in the Fall 2026-27 data', () => {
  it('lab L3+L4 (Mon 10:50–12:30) clashes with theory D1 (Mon 10:50–11:40) — different slot names', () => {
    // CSE2001 row 26: A2 + L3+L4.  CSE2046 row 16: D1 + L7+L8. Their only overlap is the lab over D1.
    const lab = section('CSE2001', 'A2 · L3+L4');
    const theory = section('CSE2046', 'D1 · L7+L8');
    const c = sectionClash(lab, theory)!;
    expect(c).not.toBeNull();
    expect(c.pairs.map(([a, b]) => `${a.slot} ${formatMeeting(a)} × ${b.slot} ${formatMeeting(b)}`)).toEqual(['L3+L4 Mon 10:50–12:30 × D1 Mon 10:50–11:40']);
  });

  it('lab L3+L4 also clashes with TC1 (Mon 11:45–12:35) by a partial overlap', () => {
    // MAT2002 rows 154/159/162: E1+TC1.
    const c = sectionClash(section('CSE2001', 'A2 · L3+L4'), section('MAT2002', 'E1+TC1'))!;
    expect(c.pairs.map(([a, b]) => `${a.slot}×${b.slot}`)).toEqual(['L3+L4×TC1']);
  });

  it('CSE2001 row 26 and CSE2006 row 57 clash twice: lab over D1, and A2 against lab L21+L22', () => {
    const c = sectionClash(section('CSE2001', 'A2 · L3+L4'), section('CSE2006', 'D1 · L21+L22'))!;
    expect(c.pairs.map(([a, b]) => `${a.slot}×${b.slot}`).sort()).toEqual(['A2×L21+L22', 'L3+L4×D1']);
  });

  it('back-to-back real slots do not clash: L1+L2 ends 10:40, D1 starts 10:50 (Mon)', () => {
    // CSE2022 row 70: G1 + L1+L2 (Mon 09:00–10:40; G1 is Tue/Thu).  CSE2046 row 16: D1 (Mon 10:50) + L7+L8 (Tue 10:50).
    expect(sectionClash(section('CSE2022', 'G1 · L1+L2'), section('CSE2046', 'D1 · L7+L8'))).toBeNull();
  });

  it('solver never returns a combination containing the real clash', () => {
    const picks = ['CSE2001', 'CSE2006', 'MAT2002', 'CSE2046', 'ECE3026'].map(course);
    const res = solve(picks, { limit: 100_000 });
    expect(res.count).toBeGreaterThan(0);
    for (const combo of res.combinations) {
      const ids = combo.map((s) => s.id);
      expect(ids.includes(section('CSE2001', 'A2 · L3+L4').id) && ids.includes(section('CSE2006', 'D1 · L21+L22').id)).toBe(false);
    }
  });
});

describe('"times unknown" in solving and exports', () => {
  it('a combination with a times-unknown section is found but never counted as clash-free', () => {
    const res = solve([course('CSE2001'), course('KAN1004')]);
    expect(res.count).toBe(8);
    expect(res.clashFreeCount).toBe(0);
    expect(res.unknownTimesCount).toBe(8);
    const txt = comboText(res.combinations[0], r.courses);
    expect(txt).toContain('KAN1004');
    expect(txt).toContain('times unknown — verify on the portal');
    expect(txt).toContain('NOT verified clash-free');
  });

  it('a partly-known section still blocks on its known time', () => {
    const cse2007 = course('CSE2007');
    const onlyUnknown = new Set(cse2007.components[0].sections.filter((x) => x.timesUnknown === undefined).map((x) => x.id));
    // Only C2 · L33+L34 of CSE2001 left: it clashes with the known lab L33+L34 of row 38.
    const cse2001Others = new Set(course('CSE2001').components[0].sections.filter((x) => x.section !== 'C2 · L33+L34').map((x) => x.id));
    const res = solve([course('CSE2001'), cse2007], { unavailable: new Set([...onlyUnknown, ...cse2001Others]) });
    expect(res.count).toBe(0);
  });

  it('a genuine project course stays never-clashing and verified', () => {
    const res = solve([course('CSE2001'), course('ECE3026')]);
    expect(res.count).toBe(8);
    expect(res.clashFreeCount).toBe(8);
    expect(res.unknownTimesCount).toBe(0);
  });
});

describe('privacy: stored rows', () => {
  it('sanitising keeps every slot cell, so the sheet parses exactly the same', () => {
    expect(parseRegistrationRows(sanitizeRegistrationRows(rows), grid)).toEqual(r);
  });

  it('blanks free text in the slot columns (names, rooms, notes) and nothing else', () => {
    const withText = rows.map((row, i) =>
      i === 169 ? row.map((c, j) => (j === 8 ? 'Dr. Example Person' : c)) : i === 212 ? row.map((c, j) => (j === 7 ? '226' : c)) : row,
    );
    const clean = sanitizeRegistrationRows(withText);
    const flat = JSON.stringify(clean);
    expect(flat).not.toContain('Example Person');
    expect(clean[212][7]).toBe('');
    expect(clean[212][8]).toBe(''); // "Open Elective"
    expect(clean[8][8]).toBe('L23+L24,31+32'); // bare-number lab pair kept
    expect(clean[81][8]).toMatch(/PROJECT BASED/); // project marker kept
    expect(clean[0]).toEqual(rows[0]); // headers untouched
  });
});

describe('file routing', () => {
  it('sends the real .xlsx to the university importer', async () => {
    const buf = readFileSync(XLSX_PATH);
    const src = await loadTimetableFile({
      name: 'Course_Registration_File.xlsx',
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      text: async () => '',
    });
    expect(src.kind).toBe('university');
    if (src.kind === 'university') expect(src.rows).toEqual(sanitizeRegistrationRows(rows));
  });

  it('sends a CSV saved from the registration file to the university importer', async () => {
    const csv = rows.map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    const src = await loadTimetableFile({ name: 'reg.csv', arrayBuffer: async () => new ArrayBuffer(0), text: async () => csv });
    expect(src.kind).toBe('university');
    // Blank rows must survive so that reported row numbers still match the spreadsheet.
    if (src.kind === 'university') expect(parseRegistrationRows(src.rows, grid).stats).toEqual(r.stats);
  });

  it('still sends the canonical CSV to the canonical importer', async () => {
    const src = await loadTimetableFile({ name: 'x.csv', arrayBuffer: async () => new ArrayBuffer(0), text: async () => 'course_code,section,credits\nA,1,3' });
    expect(src.kind).toBe('canonical');
  });
});
