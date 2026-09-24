/**
 * Spreadsheet reading via SheetJS, installed from the vendor's tarball (cdn.sheetjs.com), not the
 * unmaintained npm "xlsx" 0.18. Only ever loaded through a dynamic import() in load.ts, so it
 * is split into its own chunk and downloaded only when a student uploads a spreadsheet.
 */
import { read, utils } from 'xlsx';

export interface SheetRows {
  name: string;
  /** Cell text by spreadsheet row; index 0 is row 1 even if the used range starts lower. */
  rows: string[][];
}

export async function readWorkbookRows(buf: ArrayBuffer): Promise<SheetRows[]> {
  const wb = read(new Uint8Array(buf), { type: 'array', cellDates: true, dense: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'];
    if (!ref) return { name, rows: [] };
    const range = utils.decode_range(ref);
    // Keep formatted text (what the student sees) and blank rows, so row numbers match Excel's.
    const body = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
    const lead = Array.from({ length: range.s.r }, () => [] as string[]);
    const pad = Array.from({ length: range.s.c }, () => '');
    return { name, rows: [...lead, ...body.map((r) => [...pad, ...r.map((c) => (c == null ? '' : String(c)))])] };
  });
}
