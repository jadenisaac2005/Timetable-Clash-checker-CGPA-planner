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
}

export interface Timetable {
  courses: Course[];
  warnings: string[];
}

export function sectionId(courseCode: string, component: string, section: string): string {
  return `${courseCode}|${component}|${section}`;
}
