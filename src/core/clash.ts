import type { Meeting, Section } from './model';
import { overlappingPairs } from './time';

export interface SectionClash {
  a: Section;
  b: Section;
  pairs: [Meeting, Meeting][];
}

/** Clash between two sections, by real time overlap only. Slot names are never compared. */
export function sectionClash(a: Section, b: Section): SectionClash | null {
  const pairs = overlappingPairs(a.meetings, b.meetings);
  return pairs.length ? { a, b, pairs } : null;
}

/** Every clashing pair within a chosen set of sections. */
export function findClashes(sections: readonly Section[]): SectionClash[] {
  const out: SectionClash[] = [];
  for (let i = 0; i < sections.length; i++)
    for (let j = i + 1; j < sections.length; j++) {
      const c = sectionClash(sections[i], sections[j]);
      if (c) out.push(c);
    }
  return out;
}
