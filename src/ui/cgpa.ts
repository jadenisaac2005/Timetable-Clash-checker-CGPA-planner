import {
  DEFAULT_SCALE,
  gpa,
  projectCgpa,
  requiredAverage,
  scaleBounds,
  tallyAll,
  tallySemester,
  validateScale,
  type GradeScale,
  type GradedCourse,
  type PastSemester,
  type Tally,
} from '../core/cgpa';
import { fmt, h } from './dom';
import { selectedCourses } from './planner';
import type { Store } from './store';

/** "[CODE] credits grade" per line. */
export function parseGradeLines(text: string): { courses: GradedCourse[]; errors: string[] } {
  const courses: GradedCourse[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const parts = t.split(/[\s,;\t]+/);
    const m = parts.length === 3 ? parts : parts.length === 2 ? [undefined, ...parts] : null;
    const cr = m ? Number(m[1]) : NaN;
    if (!m || !Number.isFinite(cr) || cr < 0) errors.push(`Line ${i + 1}: expected "[CODE] credits grade", got "${t}"`);
    else courses.push({ code: m[0]?.toUpperCase(), credits: cr, grade: m[2]! });
  });
  return { courses, errors };
}

function scaleToText(s: GradeScale): string {
  return s.grades.map((g) => `${g.grade} ${g.points}${g.counts === false ? ' nc' : ''}`).join('\n');
}

function textToScale(text: string, name: string): { scale: GradeScale; errors: string[] } {
  const errors: string[] = [];
  const grades = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l, i) => {
      const [grade, pts, flag] = l.split(/\s+/);
      if (!grade || pts === undefined || !Number.isFinite(Number(pts))) errors.push(`Line ${i + 1}: expected "GRADE points", got "${l}"`);
      return { grade, points: Number(pts), ...(flag?.toLowerCase() === 'nc' ? { counts: false } : {}) };
    });
  const scale = { name, grades };
  return { scale, errors: [...errors, ...validateScale(scale)] };
}

let scaleErrors: string[] = [];
const semesterErrors = new Map<number, string[]>();

function safeTally(fn: () => Tally): { t: Tally | null; err: string | null } {
  try {
    return { t: fn(), err: null };
  } catch (e) {
    return { t: null, err: (e as Error).message };
  }
}

export function renderCgpa(store: Store): HTMLElement {
  const c = store.state.cgpa;
  const scale = c.scale;
  const { max } = scaleBounds(scale);
  const current = safeTally(() => tallyAll(c.past, scale));
  const cur = current.t;

  // ---- Past semesters
  const semRows = c.past.map((sem, i) => {
    const t = safeTally(() => tallySemester(sem, scale));
    const setSem = (fn: (s: PastSemester) => PastSemester) => store.update((s) => void (s.cgpa.past[i] = fn(s.cgpa.past[i])));
    const body =
      sem.kind === 'sgpa'
        ? h(
            'div',
            { class: 'row wrap' },
            h('label', null, 'SGPA ', h('input', { type: 'number', step: 0.01, min: 0, max, class: 'narrow', value: sem.sgpa, onchange: (e: Event) => setSem((s) => ({ ...(s as Extract<PastSemester, { kind: 'sgpa' }>), sgpa: Number((e.target as HTMLInputElement).value) })) })),
            h('label', null, 'Credits ', h('input', { type: 'number', step: 0.5, min: 0, class: 'narrow', value: sem.credits, onchange: (e: Event) => setSem((s) => ({ ...(s as Extract<PastSemester, { kind: 'sgpa' }>), credits: Number((e.target as HTMLInputElement).value) })) })),
          )
        : h(
            'div',
            null,
            h('textarea', {
              rows: 5,
              spellcheck: 'false',
              placeholder: 'CSE101 4 A+\nMAT101 4 A\nENG101 1 O',
              value: sem.courses.map((x) => `${x.code ?? ''} ${x.credits} ${x.grade}`.trim()).join('\n'),
              onchange: (e: Event) => {
                const { courses, errors } = parseGradeLines((e.target as HTMLTextAreaElement).value);
                semesterErrors.set(i, errors);
                setSem(() => ({ kind: 'courses', label: sem.label, courses }));
              },
            }),
            (semesterErrors.get(i) ?? []).map((e) => h('p', { class: 'error small' }, e)),
          );
    return h(
      'div',
      { class: 'semester' },
      h(
        'div',
        { class: 'row wrap' },
        h('input', { type: 'text', class: 'label-input', value: sem.label ?? `Semester ${i + 1}`, onchange: (e: Event) => setSem((s) => ({ ...s, label: (e.target as HTMLInputElement).value })) }),
        h(
          'select',
          {
            onchange: (e: Event) =>
              setSem((s) => {
                const kind = (e.target as HTMLSelectElement).value;
                const t2 = safeTally(() => tallySemester(s, scale)).t;
                return kind === 'sgpa'
                  ? { kind: 'sgpa', label: s.label, sgpa: Number(fmt(gpa(t2 ?? { credits: 0, points: 0 }) ?? 0)), credits: t2?.credits ?? 0 }
                  : { kind: 'courses', label: s.label, courses: [] };
              }),
          },
          h('option', { value: 'sgpa', selected: sem.kind === 'sgpa' }, 'SGPA + credits'),
          h('option', { value: 'courses', selected: sem.kind === 'courses' }, 'Per-course grades'),
        ),
        h('span', { class: 'muted' }, t.err ? h('span', { class: 'error' }, t.err) : `${t.t!.credits} cr · SGPA ${fmt(gpa(t.t!))}`),
        h('button', { class: 'btn ghost small', onclick: () => store.update((s) => void s.cgpa.past.splice(i, 1)), 'aria-label': 'Remove semester' }, 'Remove'),
      ),
      body,
    );
  });

  const pastCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Past semesters'),
    semRows.length ? semRows : h('p', { class: 'muted' }, 'No semesters yet.'),
    h(
      'div',
      { class: 'row wrap' },
      h('button', { class: 'btn secondary', onclick: () => store.update((s) => void s.cgpa.past.push({ kind: 'sgpa', label: `Semester ${s.cgpa.past.length + 1}`, sgpa: 0, credits: 0 })) }, '+ Semester (SGPA)'),
      h('button', { class: 'btn secondary', onclick: () => store.update((s) => void s.cgpa.past.push({ kind: 'courses', label: `Semester ${s.cgpa.past.length + 1}`, courses: [] })) }, '+ Semester (grades)'),
    ),
  );

  const summary = h(
    'section',
    { class: 'card highlight' },
    h('div', { class: 'stat' }, h('span', null, 'Current CGPA'), h('strong', null, current.err ? '—' : fmt(gpa(cur!)))),
    h('div', { class: 'stat' }, h('span', null, 'Credits counted'), h('strong', null, cur ? String(cur.credits) : '—')),
    current.err ? h('p', { class: 'error' }, current.err) : null,
  );

  // ---- Target
  let targetOut: HTMLElement | null = null;
  if (cur && c.target !== null && c.remainingCredits !== null) {
    const r = requiredAverage(cur, c.remainingCredits, c.target, scale);
    const msg =
      r.status === 'unreachable'
        ? h('p', { class: 'error' }, `Not reachable: you would need an average of ${fmt(r.required)} on the remaining ${c.remainingCredits} credits, but the maximum grade point is ${max}. Best possible CGPA: ${fmt(r.best)}.`)
        : r.status === 'guaranteed'
          ? h('p', { class: 'ok' }, `Already secured: even the lowest grade point on every remaining credit leaves you at ${fmt(r.worst)}.`)
          : r.status === 'no-remaining'
            ? h('p', null, `No credits remaining — CGPA is fixed at ${fmt(r.best)}.`)
            : h('p', null, 'You need an average grade point of ', h('strong', null, fmt(r.required)), ` on the remaining ${c.remainingCredits} credits. Range still possible: ${fmt(r.worst)} – ${fmt(r.best)}.`);
    targetOut = msg;
  }
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const curriculumTotal = store.state.curriculum?.totalCredits;
  const targetCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'Target CGPA'),
    h(
      'div',
      { class: 'row wrap' },
      h('label', null, 'Target ', h('input', { type: 'number', step: 0.01, min: 0, max, class: 'narrow', value: c.target ?? '', onchange: (e: Event) => store.update((s) => void (s.cgpa.target = num((e.target as HTMLInputElement).value))) })),
      h('label', null, 'Credits remaining in programme ', h('input', { type: 'number', step: 0.5, min: 0, class: 'narrow', value: c.remainingCredits ?? '', onchange: (e: Event) => store.update((s) => void (s.cgpa.remainingCredits = num((e.target as HTMLInputElement).value))) })),
      curriculumTotal && cur
        ? h('button', { class: 'btn ghost small', onclick: () => store.update((s) => void (s.cgpa.remainingCredits = Math.max(0, curriculumTotal - cur.credits))) }, `Use curriculum total (${curriculumTotal} − ${cur.credits})`)
        : null,
    ),
    targetOut ?? h('p', { class: 'muted' }, 'Enter a target and the credits still to be earned (including this semester).'),
  );

  // ---- What-if
  const grades = scale.grades.map((g) => g.grade);
  const planned = c.planned;
  const proj = safeTally(() => projectCgpa(cur ?? { credits: 0, points: 0 }, planned, scale).tally);
  const semOnly = safeTally(() => projectCgpa({ credits: 0, points: 0 }, planned, scale).tally);
  const plannedCredits = planned.reduce((t, p) => t + p.credits, 0);
  const setPlanned = (i: number, patch: Partial<(typeof planned)[number]>) => store.update((s) => void (s.cgpa.planned[i] = { ...s.cgpa.planned[i], ...patch }));
  const whatIfCard = h(
    'section',
    { class: 'card' },
    h('h2', null, 'This semester: what-if'),
    h(
      'div',
      { class: 'row wrap' },
      h(
        'button',
        {
          class: 'btn secondary',
          onclick: () =>
            store.update((s) => {
              const existing = new Map(s.cgpa.planned.map((p) => [p.code, p.grade]));
              s.cgpa.planned = selectedCourses(store).map((x) => ({ code: x.code, credits: x.credits, grade: existing.get(x.code) ?? grades[0] }));
            }),
        },
        'Fill from Planner selection',
      ),
      h('button', { class: 'btn ghost', onclick: () => store.update((s) => void s.cgpa.planned.push({ code: '', credits: 3, grade: grades[0] })) }, '+ Course'),
    ),
    planned.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            null,
            h('thead', null, h('tr', null, h('th', null, 'Course'), h('th', null, 'Credits'), h('th', null, 'Expected grade'), h('th', null, ''))),
            h(
              'tbody',
              null,
              planned.map((p, i) =>
                h(
                  'tr',
                  null,
                  h('td', null, h('input', { type: 'text', value: p.code, class: 'code-input', onchange: (e: Event) => setPlanned(i, { code: (e.target as HTMLInputElement).value.toUpperCase() }) })),
                  h('td', null, h('input', { type: 'number', min: 0, step: 0.5, class: 'narrow', value: p.credits, onchange: (e: Event) => setPlanned(i, { credits: Number((e.target as HTMLInputElement).value) }) })),
                  h('td', null, h('select', { onchange: (e: Event) => setPlanned(i, { grade: (e.target as HTMLSelectElement).value }) }, grades.map((g) => h('option', { value: g, selected: g === p.grade }, g)), grades.includes(p.grade) ? null : h('option', { value: p.grade, selected: true }, `${p.grade} (not in scale)`))),
                  h('td', null, h('button', { class: 'btn ghost small', onclick: () => store.update((s) => void s.cgpa.planned.splice(i, 1)) }, '✕')),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Add the courses you are taking this semester and the grade you expect in each.'),
    planned.length
      ? h(
          'div',
          { class: 'row wrap stats' },
          h('div', { class: 'stat' }, h('span', null, 'Projected SGPA'), h('strong', null, semOnly.err ? '—' : fmt(gpa(semOnly.t!)))),
          h('div', { class: 'stat' }, h('span', null, 'Projected CGPA'), h('strong', null, proj.err ? '—' : fmt(gpa(proj.t!)))),
          proj.err ? h('p', { class: 'error' }, proj.err) : null,
        )
      : null,
    planned.length && cur && c.target !== null
      ? (() => {
          const r = requiredAverage(cur, plannedCredits, c.target!, scale);
          return h(
            'p',
            { class: r.status === 'unreachable' ? 'error' : 'muted' },
            r.status === 'unreachable'
              ? `A CGPA of ${c.target} by the end of this semester is not reachable (would need ${fmt(r.required)} average; best is ${fmt(r.best)}).`
              : r.status === 'guaranteed'
                ? `You will be at or above ${c.target} after this semester whatever the grades.`
                : `To be at ${c.target} by the end of this semester you need an SGPA of at least ${fmt(r.required)} on these ${plannedCredits} credits.`,
          );
        })()
      : null,
  );

  // ---- Scale
  const scaleCard = h(
    'section',
    { class: 'card' },
    h(
      'details',
      null,
      h('summary', null, h('strong', null, 'Grade-point scale: '), scale.name),
      h('p', { class: 'warn' }, 'Check this against the grade card or academic regulations for your programme. The default is a common 10-point scale, not necessarily your university\'s.'),
      h('p', { class: 'muted small' }, 'One grade per line: "GRADE points". Add "nc" for grades that carry no credit weight (e.g. audit).'),
      h('textarea', {
        rows: 9,
        spellcheck: 'false',
        value: scaleToText(scale),
        onchange: (e: Event) => {
          const { scale: next, errors } = textToScale((e.target as HTMLTextAreaElement).value, 'Custom scale');
          scaleErrors = errors;
          if (!errors.length) store.update((s) => void (s.cgpa.scale = next));
          else store.update(() => {});
        },
      }),
      scaleErrors.map((e) => h('p', { class: 'error small' }, e)),
      h('button', { class: 'btn ghost small', onclick: () => ((scaleErrors = []), store.update((s) => void (s.cgpa.scale = structuredClone(DEFAULT_SCALE))), undefined) }, 'Reset to default'),
    ),
  );

  return h('div', { class: 'stack' }, summary, pastCard, targetCard, whatIfCard, scaleCard);
}
