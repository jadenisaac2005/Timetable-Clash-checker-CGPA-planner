import { describe, expect, it } from 'vitest';
import { solve, isFeasible, comboStats } from '../src/core/solver';
import { findClashes } from '../src/core/clash';
import type { Course } from '../src/core/model';
import { course, mt, sec } from './helpers';

const ids = (combo: { id: string }[]) => combo.map((s) => s.id).join(', ');

describe('solve — enumeration', () => {
  it('enumerates exactly the clash-free combinations', () => {
    const a = course('A', { '1': [mt('Mon', '09:00', '10:00')], '2': [mt('Tue', '09:00', '10:00')] });
    const b = course('B', { '1': [mt('Mon', '09:30', '10:30')], '2': [mt('Wed', '09:00', '10:00')] });
    const r = solve([a, b]);
    expect(r.count).toBe(3);
    expect(r.combinations.map(ids).sort()).toEqual(
      ['A|main|1, B|main|2', 'A|main|2, B|main|1', 'A|main|2, B|main|2'].sort(),
    );
    expect(r.diagnosis).toBeNull();
    for (const c of r.combinations) expect(findClashes(c)).toEqual([]);
  });

  it('matches brute force on a randomised timetable', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const days = ['Mon', 'Tue', 'Wed'] as const;
    const courses: Course[] = [];
    for (let c = 0; c < 5; c++) {
      const sections: Record<string, ReturnType<typeof mt>[]> = {};
      for (let s = 0; s < 3; s++) {
        const start = 8 * 60 + Math.floor(rand() * 8) * 50;
        const len = rand() < 0.3 ? 100 : 50;
        const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
        sections[String(s)] = [mt(days[Math.floor(rand() * 3)], fmt(start), fmt(start + len))];
      }
      courses.push(course(`C${c}`, sections));
    }
    let brute = 0;
    const walk = (i: number, picked: ReturnType<typeof sec>[]) => {
      if (i === courses.length) {
        if (findClashes(picked).length === 0) brute++;
        return;
      }
      for (const s of courses[i].components[0].sections) walk(i + 1, [...picked, s]);
    };
    walk(0, []);
    expect(solve(courses, { limit: 10_000 }).count).toBe(brute);
  });

  it('keeps combinations in input course order regardless of search order', () => {
    const big = course('BIG', { '1': [mt('Mon', '8:00', '9:00')], '2': [mt('Tue', '8:00', '9:00')], '3': [mt('Wed', '8:00', '9:00')] });
    const small = course('SMALL', { X: [mt('Thu', '8:00', '9:00')] });
    const r = solve([big, small]);
    expect(r.combinations.every((c) => c[0].courseCode === 'BIG' && c[1].courseCode === 'SMALL')).toBe(true);
  });

  it('project course with no slot never blocks anything', () => {
    const project = course('PRJ', { P: [] }, 6);
    const a = course('A', { '1': [mt('Mon', '09:00', '10:00')] });
    const r = solve([a, project]);
    expect(r.count).toBe(1);
    expect(r.combinations[0].map((s) => s.courseCode)).toEqual(['A', 'PRJ']);
  });

  it('lab vs theory with different slot names is caught by time', () => {
    const lab = course('LAB', { L1: [mt('Mon', '10:50', '12:30', 'L1+L2')] });
    const th = course('TH', { B1: [mt('Mon', '10:50', '11:40', 'B1')] });
    expect(isFeasible([lab, th])).toBe(false);
  });

  it('back-to-back sections are feasible together', () => {
    const a = course('A', { '1': [mt('Mon', '10:00', '10:50')] });
    const b = course('B', { '1': [mt('Mon', '10:50', '11:40')] });
    expect(solve([a, b]).count).toBe(1);
  });

  it('TEL with separate theory and lab components picks one of each and they must not clash with each other', () => {
    const tel: Course = {
      code: 'TEL',
      title: 'TEL',
      credits: 4,
      type: 'tel',
      components: [
        { name: 'theory', sections: [sec('TEL', 'A', [mt('Mon', '10:50', '11:40')], 'theory'), sec('TEL', 'B', [mt('Tue', '9:00', '9:50')], 'theory')] },
        { name: 'lab', sections: [sec('TEL', 'L1', [mt('Mon', '10:50', '12:30')], 'lab'), sec('TEL', 'L2', [mt('Wed', '10:50', '12:30')], 'lab')] },
      ],
    };
    const r = solve([tel]);
    // A+L1 clash (Mon 10:50); remaining 3 combos are valid.
    expect(r.count).toBe(3);
    expect(r.combinations.map(ids)).not.toContain('TEL|theory|A, TEL|lab|L1');
  });

  it('respects unavailable sections and re-solves', () => {
    const a = course('A', { '1': [mt('Mon', '9:00', '10:00')], '2': [mt('Tue', '9:00', '10:00')] });
    const b = course('B', { '1': [mt('Mon', '9:00', '10:00')], '2': [mt('Wed', '9:00', '10:00')] });
    expect(solve([a, b]).count).toBe(3);
    expect(solve([a, b], { unavailable: new Set(['A|main|2']) }).count).toBe(1);
    const none = solve([a, b], { unavailable: new Set(['A|main|2', 'B|main|2']) });
    expect(none.count).toBe(0);
    expect(none.diagnosis!.minimalConflict.sort()).toEqual(['A', 'B']);
  });

  it('truncates stored combinations but keeps counting', () => {
    const cs = ['A', 'B', 'C'].map((code, i) =>
      course(code, Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu'].map((d) => [d, [mt(d as never, `${8 + i}:00`, `${8 + i}:50`)]]))),
    );
    const r = solve(cs, { limit: 5 });
    expect(r.count).toBe(64);
    expect(r.combinations).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(solve(cs, { limit: 5, countLimit: 10 }).countCapped).toBe(true);
  });

  it('empty selection has one trivial (empty) combination and no diagnosis', () => {
    const r = solve([]);
    expect(r.count).toBe(1);
    expect(r.diagnosis).toBeNull();
  });
});

describe('solve — infeasibility diagnosis', () => {
  const a = course('A', { '1': [mt('Mon', '9:00', '10:00')], '2': [mt('Tue', '9:00', '10:00')] });
  const b = course('B', { '1': [mt('Mon', '9:30', '10:30')], '2': [mt('Tue', '9:30', '10:30')] });
  const c = course('C', { '1': [mt('Mon', '9:00', '9:50')], '2': [mt('Tue', '9:00', '9:50')] });
  const d = course('D', { '1': [mt('Fri', '9:00', '10:00')] });

  it('identifies the course that makes the set infeasible', () => {
    // A and B fit (A1+B2 / A2+B1). D is independent. Adding C: A,B,C need 3 distinct days of {Mon,Tue}.
    expect(isFeasible([a, b, d])).toBe(true);
    const r = solve([a, b, c, d]);
    expect(r.count).toBe(0);
    const dg = r.diagnosis!;
    expect(dg.culprits.sort()).toEqual(['A', 'B', 'C']);
    expect(dg.culprits).not.toContain('D');
    expect(dg.minimalConflict.sort()).toEqual(['A', 'B', 'C']);
    expect(dg.pairwise).toEqual([]);
    expect(dg.firstBreaking).toBe('C');
    // Only sections of A, B, C appear in the blocking clashes.
    const involved = new Set(dg.blockingClashes.flatMap((x) => [x.a.courseCode, x.b.courseCode]));
    expect([...involved].sort()).toEqual(['A', 'B', 'C']);
  });

  it('reports an always-clashing pair', () => {
    const x = course('X', { '1': [mt('Wed', '9:00', '10:00')] });
    const y = course('Y', { '1': [mt('Wed', '9:30', '11:00')], '2': [mt('Wed', '8:00', '9:10')] });
    const dg = solve([x, y, d]).diagnosis!;
    expect(dg.pairwise).toEqual([{ a: 'X', b: 'Y' }]);
    expect(dg.minimalConflict.sort()).toEqual(['X', 'Y']);
    expect(dg.culprits.sort()).toEqual(['X', 'Y']);
    expect(dg.blockingClashes).toHaveLength(2);
  });

  it('reports components with every section unavailable', () => {
    const dg = solve([a, d], { unavailable: new Set(['D|main|1']) }).diagnosis!;
    expect(dg.emptyComponents).toEqual([{ courseCode: 'D', component: 'main', unavailableSections: ['1'] }]);
    expect(dg.minimalConflict).toEqual(['D']);
    expect(dg.culprits).toEqual(['D']);
    expect(dg.pairwise).toEqual([]);
  });

  it('diagnoses a TEL course whose own theory and lab can never fit', () => {
    const tel: Course = {
      code: 'TEL',
      title: 'TEL',
      credits: 4,
      type: 'tel',
      components: [
        { name: 'theory', sections: [sec('TEL', 'A', [mt('Mon', '11:00', '11:50')], 'theory')] },
        { name: 'lab', sections: [sec('TEL', 'L1', [mt('Mon', '10:50', '12:30')], 'lab')] },
      ],
    };
    const dg = solve([tel, d]).diagnosis!;
    expect(dg.minimalConflict).toEqual(['TEL']);
    expect(dg.blockingClashes).toHaveLength(1);
  });
});

describe('comboStats', () => {
  it('computes credits, days and gaps', () => {
    const a = course('A', { '1': [mt('Mon', '9:00', '10:00'), mt('Wed', '9:00', '10:00')] }, 3);
    const b = course('B', { '1': [mt('Mon', '11:00', '12:00')] }, 4);
    const combo = solve([a, b]).combinations[0];
    expect(comboStats(combo, [a, b])).toEqual({ credits: 7, days: 2, gapMinutes: 60, earliestStart: 540, latestEnd: 720 });
  });
});
