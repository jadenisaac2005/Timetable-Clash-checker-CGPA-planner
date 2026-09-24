import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { docxTables, tablesFromDocumentXml } from '../src/import/docx';
import { parseSlotGrid } from '../src/import/university/slotGrid';
import { FALL_2026_27_SLOT_TABLE } from '../src/import/university/fall2026Grid';
import { formatMeeting } from '../src/core/time';

const DOCX = new URL('../data/Slot_Timetable_for_Fall_2026-27_Semester.docx', import.meta.url);

describe('slot timetable .docx (real file)', () => {
  it('extracts the grid exactly as the built-in Fall 2026-27 table', async () => {
    const tables = await docxTables(readFileSync(DOCX));
    expect(tables).toHaveLength(3);
    expect(tables[0]).toEqual(FALL_2026_27_SLOT_TABLE);
  });

  const grid = parseSlotGrid(FALL_2026_27_SLOT_TABLE);
  const times = (m: Map<string, { day: string; start: number; end: number }[]>, k: string) => m.get(k)!.map((x) => formatMeeting(x as never));

  it('parses without errors and resolves 12-hour times without AM/PM as afternoon', () => {
    expect(grid.errors).toEqual([]);
    // Theory row writes "1.15 – 2.05", "4.00 – 4.50" with no AM/PM; the lab row writes "1.15 PM".
    expect(times(grid.theory, 'A2')).toEqual(['Mon 13:15–14:05', 'Wed 14:10–15:00', 'Fri 15:05–15:55']);
    expect(times(grid.theory, 'TC2')).toEqual(['Mon 16:00–16:50']);
  });

  it('maps every theory slot to its days (cells of the MON…FRI Theory rows)', () => {
    expect(grid.theory.size).toBe(20);
    expect(times(grid.theory, 'A1')).toEqual(['Mon 09:00–09:50', 'Wed 09:55–10:45', 'Fri 10:50–11:40']);
    expect(times(grid.theory, 'D1')).toEqual(['Mon 10:50–11:40', 'Thu 09:00–09:50']);
    expect(times(grid.theory, 'TA1')).toEqual(['Tue 11:45–12:35']);
    expect(times(grid.theory, 'C1')).toEqual(['Wed 09:00–09:50', 'Thu 11:45–12:35', 'Fri 09:55–10:45']);
  });

  it('maps lab slots L1…L40 to 100-minute blocks shared by each odd/even pair', () => {
    expect(grid.lab.size).toBe(40);
    expect(times(grid.lab, 'L3')).toEqual(['Mon 10:50–12:30']);
    expect(times(grid.lab, 'L4')).toEqual(['Mon 10:50–12:30']);
    expect(times(grid.lab, 'L40')).toEqual(['Fri 15:05–16:45']);
  });

  it('handles vertical and horizontal merges and XML entities', () => {
    const xml = `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>X</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`;
    expect(tablesFromDocumentXml(xml)).toEqual([[['A & B', 'A & B', 'X'], ['1', '', 'X']]]);
  });

  it('reports out-of-order or unreadable times instead of guessing', () => {
    const bad = FALL_2026_27_SLOT_TABLE.map((r) => [...r]);
    bad[0][3] = '8.00 - 7.00';
    expect(parseSlotGrid(bad).errors.length).toBeGreaterThan(0);
  });
});
