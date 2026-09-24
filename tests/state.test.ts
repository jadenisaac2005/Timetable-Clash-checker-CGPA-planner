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
