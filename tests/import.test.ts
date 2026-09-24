import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/import/csv';
import { parseCanonicalCsv, parseSlotMap, ImportError } from '../src/import/canonical';
import { solve } from '../src/core/solver';
import sampleCsv from '../examples/sample-timetable.csv?raw';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\nz,\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['z', '']]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseCanonicalCsv', () => {
  const csv = `course_code,course_title,credits,course_type,component,section,slot,day,start,end
CSE301,Algorithms,3,theory,,A,A1,Mon,08:00,08:50
CSE301,Algorithms,3,theory,,A,A1,Wed,08:00,08:50
CSE301,,,,,B,B1,Tue,09:00,09:50
CSE310,Networks,4,tel,theory,T1,C1,Thu,10:50,11:40
CSE310,,,,lab,L1,L1+L2,Thu,10:50,12:30
CSE499,Project,6,project,,P,,,,
`;
  it('groups rows into courses, components and sections', () => {
    const t = parseCanonicalCsv(csv);
    expect(t.errors).toEqual([]);
    expect(t.courses.map((c) => c.code)).toEqual(['CSE301', 'CSE310', 'CSE499']);
    const algo = t.courses[0];
    expect(algo.credits).toBe(3);
    expect(algo.components).toHaveLength(1);
    expect(algo.components[0].sections.map((s) => [s.section, s.meetings.length])).toEqual([['A', 2], ['B', 1]]);
    const tel = t.courses[1];
    expect(tel.type).toBe('tel');
    expect(tel.components.map((c) => c.name)).toEqual(['theory', 'lab']);
    const proj = t.courses[2];
    expect(proj.components[0].sections[0].meetings).toEqual([]);
    // Parsed TEL theory and lab overlap on Thursday — the solver must see that.
    expect(solve([tel]).count).toBe(0);
  });

  it('rejects rows it cannot read instead of guessing', () => {
    const bad = `course_code,credits,section,day,start,end
X,3,A,Mon,10:00,9:00
X,3,B,Funday,10:00,11:00
X,3,C,Mon,10:00,
X,3,D,Mon,9,10`;
    const t = parseCanonicalCsv(bad);
    expect(t.errors).toHaveLength(5);
    expect(t.courses[0].components[0].sections.every((s) => s.meetings.length === 0)).toBe(true);
  });

  it('throws on missing required columns', () => {
    expect(() => parseCanonicalCsv('code,sec\nA,1')).toThrow(ImportError);
  });

  it('resolves slot names through a multi-day slot map, including combined slots', () => {
    const { slots, errors } = parseSlotMap(`slot,day,start,end
A1,Mon,08:00,08:50
A1,Wed,09:00,09:50
L1,Tue,10:50,11:40
L2,Tue,11:40,12:30`);
    expect(errors).toEqual([]);
    const t = parseCanonicalCsv(`course_code,credits,section,slot
X,3,A,A1
Y,1,L,L1+L2
Z,3,Q,ZZ9`, slots);
    const [x, y] = t.courses;
    expect(x.components[0].sections[0].meetings.map((m) => m.day)).toEqual(['Mon', 'Wed']);
    expect(y.components[0].sections[0].meetings).toHaveLength(2);
    expect(t.errors).toEqual(['row 4: slot "ZZ9" is not in the slot map']);
  });

  it('parses the shipped example file cleanly', () => {
    const t = parseCanonicalCsv(sampleCsv);
    expect(t.errors).toEqual([]);
    expect(t.courses.length).toBeGreaterThan(5);
  });
});
