export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Day = (typeof DAYS)[number];

/** One class occurrence. Times are minutes since midnight; the interval is half-open [start, end). */
export interface Meeting {
  day: Day;
  start: number;
  end: number;
  slot?: string;
}

export interface Section {
  /** Stable id: `${courseCode}|${component}|${section}` */
  id: string;
  courseCode: string;
  component: string;
  section: string;
  slots: string[];
  meetings: Meeting[];
  faculty?: string;
  room?: string;
  /** Source spreadsheet row numbers merged into this section (identical slots). */
  rows?: number[];
  /**
   * Set when the source file does not give (all of) this section's class times, e.g. no slot at
   * all. `meetings` then holds only the times that are known. Such a section can be chosen, but
   * a combination containing it is never reported as clash-free.
   */
  timesUnknown?: string;
  /** Doubts about how this section was read (e.g. a low-confidence slot spelling), shown wherever it is. */
  warnings?: string[];
}

export interface Component {
  name: string;
  sections: Section[];
}

export type CourseType = 'theory' | 'lab' | 'tel' | 'project';

export interface Course {
  code: string;
  title: string;
  credits: number;
  type: CourseType;
  /** Each component needs exactly one section chosen. */
  components: Component[];
  /** Official course code when `code` had to be disambiguated (same code, different titles). */
  officialCode?: string;
  /** Category/basket label as printed in the source file, e.g. "PC", "Robotics Basket". */
  category?: string;
  /** Sub-heading the rows appeared under, e.g. "M.Tech 2nd year". */
  audience?: string;
  /** Weekly theory (L/T) and practical (P) hours from the source file. */
  hours?: { theory: number; practical: number };
}

export interface Timetable {
  courses: Course[];
  warnings: string[];
}

/** A combination can only be called clash-free if every section's times are fully known. */
export function hasUnknownTimes(combo: readonly Section[]): boolean {
  return combo.some((s) => s.timesUnknown !== undefined);
}

/** The code as printed by the university (`code` may carry a " [title]" suffix to keep duplicates apart). */
export function officialCode(c: Course): string {
  return c.officialCode ?? c.code;
}

export function sectionId(courseCode: string, component: string, section: string): string {
  return `${courseCode}|${component}|${section}`;
}
