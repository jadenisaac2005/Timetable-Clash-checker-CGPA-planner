import { describe, expect, it } from 'vitest';
import { basketFor, computeProgress, validateCurriculum, type Curriculum } from '../src/core/curriculum';
import example from '../examples/curriculum.example.json';

const cur: Curriculum = {
  name: 't',
  baskets: [
    { id: 'core', name: 'Core', requiredCredits: 10, courses: ['CSE101', 'CSE102'] },
    { id: 'el', name: 'Electives', requiredCredits: 6, courses: ['CSE*'] },
    { id: 'oe', name: 'Open', requiredCredits: 4, courses: ['oe*'] },
  ],
};

describe('basketFor', () => {
  it('prefers exact codes over wildcards, case-insensitively', () => {
    expect(basketFor(cur, 'cse101')!.id).toBe('core');
    expect(basketFor(cur, 'CSE330')!.id).toBe('el');
    expect(basketFor(cur, 'OE12')!.id).toBe('oe');
    expect(basketFor(cur, 'MAT1')).toBeNull();
  });
});

describe('computeProgress', () => {
  it('shows before/after per basket and flags unknown planned codes', () => {
    const p = computeProgress(
      cur,
      [{ code: 'CSE101', credits: 4 }, { code: 'OE1', credits: 2 }, { code: 'XYZ9', credits: 3 }],
      [{ code: 'CSE102', credits: 4 }, { code: 'CSE330', credits: 3 }, { code: 'MAT201', credits: 3 }, { code: 'cse101', credits: 4 }],
    );
    const core = p.baskets.find((b) => b.basket.id === 'core')!;
    expect([core.completed, core.planned, core.after, core.remainingBefore, core.remainingAfter]).toEqual([4, 4, 8, 6, 2]);
    const el = p.baskets.find((b) => b.basket.id === 'el')!;
    expect([el.completed, el.planned, el.remainingAfter]).toEqual([0, 3, 3]);
    expect(p.unknownPlanned).toEqual(['MAT201']);
    expect(p.unknownCompleted).toEqual(['XYZ9']);
    expect(p.alreadyCompleted).toEqual(['CSE101']);
    expect(p.totalCompleted).toBe(6);
    expect(p.totalAfter).toBe(13);
  });

  it('never reports negative remaining credits', () => {
    const p = computeProgress(cur, [{ code: 'OE1', credits: 3 }, { code: 'OE2', credits: 3 }], []);
    expect(p.baskets.find((b) => b.basket.id === 'oe')!.remainingBefore).toBe(0);
  });
});

describe('validateCurriculum', () => {
  it('accepts the shipped example', () => expect(validateCurriculum(example)).toEqual([]));
  it('reports structural problems', () => {
    expect(validateCurriculum({ name: 'x', baskets: [{ id: 'a', name: 'A', requiredCredits: -1, courses: [1] }, { id: 'a' }] }).length).toBeGreaterThanOrEqual(3);
    expect(validateCurriculum(null)).toEqual(['Curriculum must be a JSON object']);
  });
});
