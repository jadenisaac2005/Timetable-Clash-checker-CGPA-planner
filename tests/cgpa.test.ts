import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE,
  gpa,
  projectCgpa,
  requiredAverage,
  tallyAll,
  tallyCourses,
  validateScale,
  type GradeScale,
} from '../src/core/cgpa';

describe('tallies and CGPA', () => {
  it('weights SGPA by credits (not a plain average of SGPAs)', () => {
    const t = tallyAll(
      [
        { kind: 'sgpa', sgpa: 9, credits: 20 },
        { kind: 'sgpa', sgpa: 6, credits: 10 },
      ],
      DEFAULT_SCALE,
    );
    expect(t).toEqual({ credits: 30, points: 240 });
    expect(gpa(t)).toBeCloseTo(8, 10);
  });

  it('computes per-course semesters from grades', () => {
    const t = tallyCourses(
      [
        { credits: 4, grade: 'O' },
        { credits: 3, grade: 'a+' },
        { credits: 1, grade: 'F' },
      ],
      DEFAULT_SCALE,
    );
    expect(t).toEqual({ credits: 8, points: 40 + 27 + 0 });
  });

  it('mixes SGPA and per-course semesters', () => {
    const t = tallyAll(
      [
        { kind: 'sgpa', sgpa: 8.5, credits: 22 },
        { kind: 'courses', courses: [{ credits: 3, grade: 'A' }, { credits: 3, grade: 'B' }] },
      ],
      DEFAULT_SCALE,
    );
    expect(gpa(t)).toBeCloseTo((8.5 * 22 + 24 + 18) / 28, 10);
  });

  it('rejects unknown grades rather than treating them as zero', () => {
    expect(() => tallyCourses([{ code: 'X', credits: 3, grade: 'Z' }], DEFAULT_SCALE)).toThrow(/Unknown grade "Z" for X/);
  });

  it('skips non-counting grades', () => {
    const scale: GradeScale = { name: 's', grades: [...DEFAULT_SCALE.grades, { grade: 'AU', points: 0, counts: false }] };
    expect(tallyCourses([{ credits: 3, grade: 'A' }, { credits: 2, grade: 'AU' }], scale)).toEqual({ credits: 3, points: 24 });
  });

  it('no credits → null CGPA', () => expect(gpa({ credits: 0, points: 0 })).toBeNull());
});

describe('requiredAverage', () => {
  const current = { credits: 60, points: 60 * 7.5 };

  it('solves for the average on remaining credits', () => {
    const r = requiredAverage(current, 40, 8, DEFAULT_SCALE);
    // (8*100 - 450) / 40 = 8.75
    expect(r.status).toBe('reachable');
    expect(r.required).toBeCloseTo(8.75, 10);
    expect(r.best).toBeCloseTo((450 + 400) / 100, 10);
    expect(r.worst).toBeCloseTo(450 / 100, 10);
  });

  it('flags a mathematically unreachable target', () => {
    const r = requiredAverage(current, 20, 9, DEFAULT_SCALE);
    // needs (9*80 - 450)/20 = 13.5 > 10
    expect(r.status).toBe('unreachable');
    expect(r.required).toBeCloseTo(13.5, 10);
    expect(r.best).toBeCloseTo(8.125, 10);
  });

  it('exactly-max requirement is reachable (all O grades)', () => {
    const r = requiredAverage({ credits: 20, points: 160 }, 20, 9, DEFAULT_SCALE);
    expect(r.required).toBeCloseTo(10, 10);
    expect(r.status).toBe('reachable');
  });

  it('flags an already-guaranteed target', () => {
    const r = requiredAverage({ credits: 100, points: 900 }, 10, 8, DEFAULT_SCALE);
    expect(r.status).toBe('guaranteed');
    expect(r.required!).toBeLessThan(0);
  });

  it('with no history, required = target', () => {
    expect(requiredAverage({ credits: 0, points: 0 }, 160, 8.2, DEFAULT_SCALE).required).toBeCloseTo(8.2, 10);
  });

  it('with no remaining credits reports the fixed CGPA', () => {
    const r = requiredAverage(current, 0, 9, DEFAULT_SCALE);
    expect(r.status).toBe('no-remaining');
    expect(r.best).toBeCloseTo(7.5, 10);
  });

  it('uses the configured scale maximum', () => {
    const four: GradeScale = { name: '4pt', grades: [{ grade: 'A', points: 4 }, { grade: 'B', points: 3 }, { grade: 'F', points: 0 }] };
    expect(requiredAverage({ credits: 30, points: 90 }, 30, 3.8, four).status).toBe('unreachable');
    expect(requiredAverage({ credits: 30, points: 90 }, 30, 3.4, four).status).toBe('reachable');
  });
});

describe('projectCgpa (what-if)', () => {
  it('projects the new CGPA and the semester SGPA', () => {
    const r = projectCgpa({ credits: 40, points: 320 }, [
      { credits: 4, grade: 'O' },
      { credits: 3, grade: 'A' },
      { credits: 3, grade: 'B+' },
    ], DEFAULT_SCALE);
    expect(r.sgpa).toBeCloseTo((40 + 24 + 21) / 10, 10);
    expect(r.cgpa).toBeCloseTo((320 + 85) / 50, 10);
  });
});

describe('validateScale', () => {
  it('accepts the default', () => expect(validateScale(DEFAULT_SCALE)).toEqual([]));
  it('catches duplicates and bad points', () => {
    const errs = validateScale({ name: 'x', grades: [{ grade: 'A', points: 10 }, { grade: 'a', points: -1 }] });
    expect(errs).toContain('Duplicate grade "a"');
  });
});
