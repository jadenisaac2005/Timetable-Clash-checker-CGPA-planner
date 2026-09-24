import { describe, expect, it } from 'vitest';
import { meetingsOverlap, parseDay, parseTime, formatTime } from '../src/core/time';
import { sectionClash, findClashes } from '../src/core/clash';
import { mt, sec } from './helpers';

describe('meetingsOverlap — real time intervals', () => {
  it('a lab spanning 10:50–12:30 clashes with a theory slot at 10:50–11:40 despite different slot names', () => {
    expect(meetingsOverlap(mt('Mon', '10:50', '12:30', 'L1+L2'), mt('Mon', '10:50', '11:40', 'B1'))).toBe(true);
  });

  it('a lab spanning 10:50–12:30 clashes with a theory slot at 11:40–12:30 (tail overlap)', () => {
    expect(meetingsOverlap(mt('Mon', '10:50', '12:30'), mt('Mon', '11:40', '12:30'))).toBe(true);
  });

  it('partial overlap in the middle counts', () => {
    expect(meetingsOverlap(mt('Tue', '09:00', '10:00'), mt('Tue', '09:59', '11:00'))).toBe(true);
  });

  it('containment counts', () => {
    expect(meetingsOverlap(mt('Tue', '09:00', '12:00'), mt('Tue', '10:00', '10:30'))).toBe(true);
    expect(meetingsOverlap(mt('Tue', '10:00', '10:30'), mt('Tue', '09:00', '12:00'))).toBe(true);
  });

  it('identical intervals clash', () => {
    expect(meetingsOverlap(mt('Wed', '08:00', '08:50'), mt('Wed', '08:00', '08:50'))).toBe(true);
  });

  it('back-to-back slots that touch do not clash (both orders)', () => {
    const a = mt('Mon', '10:00', '10:50');
    const b = mt('Mon', '10:50', '11:40');
    expect(meetingsOverlap(a, b)).toBe(false);
    expect(meetingsOverlap(b, a)).toBe(false);
  });

  it('same times on different days do not clash', () => {
    expect(meetingsOverlap(mt('Mon', '10:00', '11:00'), mt('Tue', '10:00', '11:00'))).toBe(false);
  });

  it('same slot name at different times does not clash (names are never compared)', () => {
    expect(meetingsOverlap(mt('Mon', '08:00', '08:50', 'A1'), mt('Mon', '09:00', '09:50', 'A1'))).toBe(false);
  });

  it('is sensitive to AM/PM', () => {
    expect(meetingsOverlap(mt('Fri', '1:00 PM', '1:50 PM'), mt('Fri', '13:00', '13:50'))).toBe(true);
    expect(meetingsOverlap(mt('Fri', '1:00 AM', '1:50 AM'), mt('Fri', '13:00', '13:50'))).toBe(false);
  });
});

describe('sectionClash', () => {
  it('multi-day sections clash if any one day overlaps', () => {
    const a = sec('A', '1', [mt('Mon', '08:00', '08:50'), mt('Wed', '08:00', '08:50'), mt('Fri', '08:00', '08:50')]);
    const b = sec('B', '1', [mt('Tue', '08:00', '08:50'), mt('Fri', '08:30', '09:20')]);
    const c = sectionClash(a, b);
    expect(c).not.toBeNull();
    expect(c!.pairs).toHaveLength(1);
    expect(c!.pairs[0][0].day).toBe('Fri');
  });

  it('multi-day sections on disjoint days do not clash', () => {
    const a = sec('A', '1', [mt('Mon', '08:00', '08:50'), mt('Wed', '08:00', '08:50')]);
    const b = sec('B', '1', [mt('Tue', '08:00', '08:50'), mt('Thu', '08:00', '08:50')]);
    expect(sectionClash(a, b)).toBeNull();
  });

  it('TEL section (theory + lab meetings) clashes with a theory course via its lab block', () => {
    const tel = sec('TEL101', 'A', [
      mt('Mon', '08:00', '08:50', 'A1'),
      mt('Wed', '08:00', '08:50', 'A1'),
      mt('Thu', '10:50', '12:30', 'L5+L6'),
    ]);
    const theory = sec('TH201', 'B', [mt('Thu', '11:40', '12:30', 'C2'), mt('Tue', '09:00', '09:50', 'C1')]);
    const c = sectionClash(tel, theory);
    expect(c).not.toBeNull();
    expect(c!.pairs.map(([x]) => x.slot)).toEqual(['L5+L6']);
  });

  it('TEL section does not clash when its lab sits next to (not over) the other class', () => {
    const tel = sec('TEL101', 'A', [mt('Mon', '08:00', '08:50'), mt('Thu', '10:50', '12:30')]);
    const theory = sec('TH201', 'B', [mt('Thu', '12:30', '13:20'), mt('Thu', '10:00', '10:50')]);
    expect(sectionClash(tel, theory)).toBeNull();
  });

  it('project course with no meetings never clashes, even with itself-like sections', () => {
    const project = sec('PRJ400', 'P', []);
    const busy = sec('X', '1', [mt('Mon', '00:00', '23:59'), mt('Tue', '00:00', '23:59')]);
    expect(sectionClash(project, busy)).toBeNull();
    expect(sectionClash(busy, project)).toBeNull();
    expect(sectionClash(project, sec('PRJ401', 'Q', []))).toBeNull();
  });

  it('findClashes lists every clashing pair', () => {
    const a = sec('A', '1', [mt('Mon', '09:00', '10:00')]);
    const b = sec('B', '1', [mt('Mon', '09:30', '10:30')]);
    const c = sec('C', '1', [mt('Mon', '10:00', '11:00')]);
    const pairs = findClashes([a, b, c]).map((x) => `${x.a.courseCode}-${x.b.courseCode}`);
    expect(pairs).toEqual(['A-B', 'B-C']);
  });
});

describe('parseTime', () => {
  it.each([
    ['10:50', 650],
    ['08:00', 480],
    ['8:00', 480],
    ['13:30', 810],
    ['1050', 650],
    ['10.50', 650],
    ['1:30 PM', 810],
    ['1:30pm', 810],
    ['12:00 PM', 720],
    ['12:10 AM', 10],
    ['9 AM', 540],
    ['9:00 a.m.', 540],
    ['0:00', 0],
  ])('%s -> %i', (input, expected) => expect(parseTime(input)).toBe(expected));

  it.each(['', '9', '25:00', '10:75', '13:00 PM', 'noon', '10-50', '0:30 AM'])('rejects %j', (input) =>
    expect(parseTime(input)).toBeNull(),
  );

  it('formats back', () => expect(formatTime(650)).toBe('10:50'));
});

describe('parseDay', () => {
  it.each([
    ['Mon', 'Mon'],
    ['MONDAY', 'Mon'],
    ['tu', 'Tue'],
    ['Th', 'Thu'],
    ['thurs', 'Thu'],
    ['Sat.', 'Sat'],
  ])('%s -> %s', (input, expected) => expect(parseDay(input)).toBe(expected));
  it('rejects unknown', () => expect(parseDay('Funday')).toBeNull());
});
