import { computeProgress, validateCurriculum, type CreditedCourse, type Curriculum } from '../core/curriculum';
import example from '../../examples/curriculum.example.json';
import { h } from './dom';
import { selectedCourses } from './planner';
import type { Store } from './store';
import { officialCode } from '../core/model';

/** "CODE credits" per line; commas, tabs or spaces as separators. */
export function parseCourseLines(text: string): { courses: CreditedCourse[]; errors: string[] } {
  const courses: CreditedCourse[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = /^([A-Za-z0-9_\-/.]+)[\s,;\t]+(\d+(?:\.\d+)?)\s*$/.exec(t);
    if (!m) errors.push(`Line ${i + 1}: expected "CODE credits", got "${t}"`);
    else courses.push({ code: m[1].toUpperCase(), credits: Number(m[2]) });
  });
  return { courses, errors };
}

let completedErrors: string[] = [];
let curriculumErrors: string[] = [];

export function renderProgress(store: Store): HTMLElement {
  const cur = store.state.curriculum;
  const loadCurriculum = (obj: unknown) => {
    curriculumErrors = validateCurriculum(obj);
    if (!curriculumErrors.length) store.update((s) => void (s.curriculum = obj as Curriculum));
    else store.update(() => {});
  };
  const configCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Curriculum config'),
    h('p', { class: 'muted' }, 'A JSON file listing your programme\'s baskets. Schema in the README; write one from your programme scheme.'),
    h(
      'div',
      { class: 'row wrap' },
      h(
        'label',
        { class: 'btn' },
        'Load curriculum JSON',
        h('input', {
          type: 'file',
          accept: '.json,application/json',
          hidden: true,
          onchange: async (e: Event) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (!f) return;
            try {
              loadCurriculum(JSON.parse(await f.text()));
            } catch (err) {
              curriculumErrors = [`Not valid JSON: ${(err as Error).message}`];
              store.update(() => {});
            }
          },
        }),
      ),
      h('button', { class: 'btn secondary', onclick: () => loadCurriculum(structuredClone(example)) }, 'Load example (fictional)'),
    ),
    cur ? h('p', null, h('strong', null, cur.name)) : null,
    curriculumErrors.length ? h('ul', { class: 'error' }, curriculumErrors.map((e) => h('li', null, e))) : null,
  );

  const completedText = store.state.completed.map((c) => `${c.code} ${c.credits}`).join('\n');
  const completedCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Completed courses'),
    h('p', { class: 'muted' }, 'One per line: course code and credits, e.g. "CSE101 4". Lines starting with # are ignored.'),
    h('textarea', {
      rows: 8,
      spellcheck: 'false',
      value: completedText,
      placeholder: 'CSE101 4\nMAT101 4\nENG101 1',
      onchange: (e: Event) => {
        const { courses, errors } = parseCourseLines((e.target as HTMLTextAreaElement).value);
        completedErrors = errors;
        store.update((s) => void (s.completed = courses));
      },
    }),
    completedErrors.length ? h('ul', { class: 'error' }, completedErrors.map((e) => h('li', null, e))) : null,
  );

  // Curriculum lists official codes, so match on those (not on disambiguated keys like "ECE3036 [title]").
  const planned = selectedCourses(store).map((c) => ({ code: officialCode(c), credits: c.credits }));
  let progressCard: HTMLElement;
  if (!cur) progressCard = h('section', { class: 'card' }, h('h2', null, 'Progress'), h('p', { class: 'muted' }, 'Load a curriculum config to see basket progress.'));
  else {
    const pr = computeProgress(cur, store.state.completed, planned);
    progressCard = h(
      'section',
      { class: 'card' },
      h('h2', null, 'Progress by basket'),
      h('p', { class: 'muted' }, `Planned semester: ${planned.length ? planned.map((c) => c.code).join(', ') : 'none (pick courses in the Planner tab)'}`),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'progress' },
          h('thead', null, h('tr', null, ['Basket', 'Required', 'Done', 'Planned', 'After', 'Left after'].map((x) => h('th', null, x)))),
          h(
            'tbody',
            null,
            pr.baskets.map((b) => {
              const req = b.basket.requiredCredits || 1;
              return h(
                'tr',
                null,
                h(
                  'td',
                  null,
                  b.basket.name,
                  h(
                    'div',
                    { class: 'bar', title: `${b.completed} done + ${b.planned} planned of ${b.basket.requiredCredits}` },
                    h('span', { class: 'done', style: { width: `${Math.min(100, (b.completed / req) * 100)}%` } }),
                    h('span', { class: 'plan', style: { width: `${Math.max(0, Math.min(100 - (b.completed / req) * 100, (b.planned / req) * 100))}%` } }),
                  ),
                ),
                h('td', null, b.basket.requiredCredits),
                h('td', null, b.completed),
                h('td', null, b.planned || ''),
                h('td', null, b.after),
                h('td', { class: b.remainingAfter === 0 ? 'ok' : '' }, b.remainingAfter === 0 ? '✓' : b.remainingAfter),
              );
            }),
          ),
          h(
            'tfoot',
            null,
            h('tr', null, h('td', null, 'Total'), h('td', null, cur.totalCredits ?? pr.baskets.reduce((t, b) => t + b.basket.requiredCredits, 0)), h('td', null, pr.totalCompleted), h('td', null, pr.totalAfter - pr.totalCompleted || ''), h('td', null, pr.totalAfter), h('td', null, '')),
          ),
        ),
      ),
      pr.unknownPlanned.length ? h('p', { class: 'warn' }, `Planned courses not in any basket of this curriculum: ${pr.unknownPlanned.join(', ')}. Check with your department before registering.`) : null,
      pr.alreadyCompleted.length ? h('p', { class: 'warn' }, `Planned but already completed: ${pr.alreadyCompleted.join(', ')}.`) : null,
      pr.unknownCompleted.length ? h('p', { class: 'muted' }, `Completed courses not matched to a basket (not counted): ${pr.unknownCompleted.join(', ')}.`) : null,
    );
  }
  return h('div', { class: 'stack' }, progressCard, completedCard, configCard);
}
