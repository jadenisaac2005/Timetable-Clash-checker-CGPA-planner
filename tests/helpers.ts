import type { Course, Day, Meeting, Section } from '../src/core/model';
import { sectionId } from '../src/core/model';
import { parseTime } from '../src/core/time';

export function mt(day: Day, start: string, end: string, slot?: string): Meeting {
  return { day, start: parseTime(start)!, end: parseTime(end)!, slot };
}

export function sec(courseCode: string, section: string, meetings: Meeting[], component = 'main'): Section {
  return {
    id: sectionId(courseCode, component, section),
    courseCode,
    component,
    section,
    slots: [...new Set(meetings.map((m) => m.slot).filter((s): s is string => !!s))],
    meetings,
  };
}

/** Build a single-component course from { sectionName: meetings }. */
export function course(code: string, sections: Record<string, Meeting[]>, credits = 3): Course {
  return {
    code,
    title: code,
    credits,
    type: 'theory',
    components: [{ name: 'main', sections: Object.entries(sections).map(([s, m]) => sec(code, s, m)) }],
  };
}
