import { describe, expect, it } from 'vitest';
import { defaultState, loadState, normalizeState, saveState, STORAGE_KEY } from '../src/state';
import { comboText, gridLayout } from '../src/export';
import { course, mt, sec } from './helpers';

describe('state persistence', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const s = defaultState();
    s.selected = ['CSE301'];
    s.maxCredits = 24;
    expect(saveState(s, storage)).toBe(true);
    expect(loadState(storage)).toEqual(s);
  });

  it('survives throwing / broken storage', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadState(throwing)).toEqual(defaultState());
    expect(saveState(defaultState(), throwing)).toBe(false);
    expect(loadState({ getItem: (k: string) => (k === STORAGE_KEY ? '{not json' : null) })).toEqual(defaultState());
  });

  it('drops malformed nested data from an imported plan instead of crashing later', () => {
    const s = normalizeState({
      version: 1,
      curriculum: {},
      completed: [{ code: 'A', credits: 3 }, { code: 'B', credits: 'x' }],
      cgpa: {
        scale: { name: 'x', grades: 'nope' },
        past: [{ kind: 'sgpa', sgpa: 8, credits: 20 }, { kind: 'sgpa', sgpa: 'x' }, { kind: 'courses', courses: [{ credits: 3 }] }, null, 5],
        planned: [{ code: 'A', credits: 3, grade: 'A' }, { code: 1 }],
        target: 'high',
      },
    });
    expect(s.curriculum).toBeNull();
    expect(s.completed).toEqual([{ code: 'A', credits: 3 }]);
    expect(s.cgpa.scale).toEqual(defaultState().cgpa.scale);
    expect(s.cgpa.past).toEqual([{ kind: 'sgpa', sgpa: 8, credits: 20 }]);
    expect(s.cgpa.planned).toEqual([{ code: 'A', credits: 3, grade: 'A' }]);
    expect(s.cgpa.target).toBeNull();
  });

  it('falls back to memory when reading localStorage itself throws', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    try {
      expect(loadState()).toEqual(defaultState());
      expect(saveState(defaultState())).toBe(false);
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('removes free text from registration rows in a saved or imported plan', () => {
    const rows = [['Sl. No.', 'Program', 'Course Code', 'Course Title', 'T', 'P', 'C', 'Lab Slot', 'Faculty_Lab'], ['1', '', 'SSK3001', 'X', '0', '2', '1', 'L3+L4', 'Dr. Example Person']];
    const s = normalizeState({ version: 1, timetable: { kind: 'university', rows, fileName: 'f.xlsx' } });
    expect(JSON.stringify(s)).not.toContain('Example Person');
  });

  it('normalizes untrusted imports', () => {
    const s = normalizeState({ version: 1, selected: ['A', 3], maxCredits: 'x', sortBy: 'evil' });
    expect(s.selected).toEqual(['A']);
    expect(s.maxCredits).toBe(26);
    expect(s.sortBy).toBe('default');
    expect(() => normalizeState({ version: 2 })).toThrow();
  });
});

describe('exports', () => {
  it('text list has code, section, slots and times', () => {
    const a = course('CSE301', { A: [mt('Mon', '09:00', '09:50', 'A1')] }, 3);
    const p = course('PRJ', { P: [] }, 4);
    const txt = comboText([a.components[0].sections[0], p.components[0].sections[0]], [a, p]);
    expect(txt).toContain('CSE301\tCSE301\tSection A\tSlots: A1\tMon 09:00–09:50');
    expect(txt).toContain('PRJ\tPRJ\tSection P\tSlots: —\tno scheduled class');
    expect(txt).toContain('Total credits: 7');
  });

  it('grid layout rounds to hours and adds weekend columns only when used', () => {
    const l = gridLayout([sec('X', '1', [mt('Sat', '08:10', '09:20')])]);
    expect(l.days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect([l.startMin, l.endMin]).toEqual([480, 600]);
  });
});
