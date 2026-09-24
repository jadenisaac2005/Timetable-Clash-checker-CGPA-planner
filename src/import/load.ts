import type { TimetableSource } from '../state';
import { parseCsv } from './csv';
import { docxTables } from './docx';
import { looksLikeRegistrationFile } from './university/registration';
import { parseSlotGrid } from './university/slotGrid';

export interface FileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export class LoadError extends Error {}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

/**
 * Route an uploaded timetable file to the right importer:
 * - the university's registration workbook (.xlsx, or a .csv saved from it) → university importer;
 * - anything else tabular → this tool's canonical CSV importer.
 * SheetJS is loaded only when a spreadsheet is actually uploaded.
 */
export async function loadTimetableFile(file: FileLike): Promise<TimetableSource> {
  const e = ext(file.name);
  let rows: string[][];
  if (e === 'xlsx' || e === 'xls' || e === 'xlsm' || e === 'ods') {
    const { readWorkbookRows } = await import('./xlsx');
    const sheets = await readWorkbookRows(await file.arrayBuffer());
    const reg = sheets.find((s) => looksLikeRegistrationFile(s.rows));
    if (reg) return { kind: 'university', rows: reg.rows, fileName: sheets.length > 1 ? `${file.name} (sheet "${reg.name}")` : file.name };
    if (!sheets.length) throw new LoadError('The workbook has no sheets.');
    rows = sheets[0].rows;
    return { kind: 'canonical', csv: rowsToCsv(rows), fileName: file.name };
  }
  if (e === 'docx') throw new LoadError('That looks like the slot timetable document. Upload it with "Slot timetable (.docx)" instead; the course list is the .xlsx registration file.');
  if (e === 'pdf') throw new LoadError('PDF timetables are not supported. Use the .xlsx registration file.');
  const text = await file.text();
  rows = parseCsv(text, undefined, true);
  if (looksLikeRegistrationFile(rows)) return { kind: 'university', rows, fileName: file.name };
  return { kind: 'canonical', csv: text, fileName: file.name };
}

/** Read the slot grid from the university's "Slot Timetable" .docx; throws if it isn't one. */
export async function loadSlotGridFile(file: FileLike): Promise<string[][]> {
  if (ext(file.name) !== 'docx') throw new LoadError('The slot timetable must be the .docx document published by the university.');
  const tables = await docxTables(await file.arrayBuffer());
  for (const t of tables) {
    const g = parseSlotGrid(t);
    if (!g.errors.length && g.theory.size && g.lab.size) return t;
  }
  throw new LoadError('No slot grid (a table with "Theory Hours" and "Lab Hours" rows and MON–FRI Theory/Lab rows) was found in this document.');
}
