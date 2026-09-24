import type { Course, Section } from '../core/model';
import { comboStats, solve, type SolveResult, type ComboStats } from '../core/solver';
import { findClashes } from '../core/clash';
import { formatMeeting, formatTime } from '../core/time';
import { colorFor, comboText, download, drawGrid, gridLayout, sectionCaveats, TIMES_UNKNOWN } from '../export';
import { hasUnknownTimes } from '../core/model';
import sampleCsv from '../../examples/sample-timetable.csv?raw';
import { details, h } from './dom';
import { LoadError, loadSlotGridFile, loadTimetableFile } from '../import/load';
import type { Parsed, Store } from './store';

const STORE_LIMIT = 5000;
const PAGE = 30;

let solveKey = '';
let solveParsed: Parsed | null = null;
let solveCache: { result: SolveResult; stats: ComboStats[] } | null = null;
let shown = PAGE;
let courseFilter = '';

function solveFor(store: Store, courses: Course[]) {
  // The parse result is a new object whenever the timetable or slot grid changes, so compare it by identity.
  const key = `${courses.map((c) => c.code).join(',')}|${store.state.unavailable.join(',')}`;
  if (key !== solveKey || store.parsed !== solveParsed || !solveCache) {
    solveKey = key;
    solveParsed = store.parsed;
    shown = PAGE;
    const result = solve(courses, { unavailable: new Set(store.state.unavailable), limit: STORE_LIMIT });
    solveCache = { result, stats: result.combinations.map((c) => comboStats(c, courses)) };
  }
  return solveCache;
}

export function selectedCourses(store: Store): Course[] {
  const p = store.parsed;
  if (!p) return [];
  return store.state.selected.map((c) => p.byCode.get(c)).filter((c): c is Course => !!c);
}

export function renderPlanner(store: Store): HTMLElement {
  const p = store.parsed;
  return h('div', { class: 'stack' }, importCard(store, p), p && !p.fatal ? coursePicker(store, p) : null, p && !p.fatal && store.state.selected.length ? sectionsCard(store, p) : null, p && !p.fatal && store.state.selected.length ? resultsCard(store, p) : null, p && !p.fatal ? chosenCard(store, p) : null);
}

function importCard(store: Store, p: Parsed | null): HTMLElement {
  const tt = store.state.timetable;
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const onTimetable = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    status.textContent = `Reading ${f.name}…`;
    try {
      const source = await loadTimetableFile(f);
      store.update((s) => {
        // Keep an uploaded slot grid / slot map when replacing the course list.
        const prev = s.timetable;
        if (source.kind === 'university' && prev?.kind === 'university' && prev.gridRows) Object.assign(source, { gridRows: prev.gridRows, gridName: prev.gridName });
        if (source.kind === 'canonical' && prev?.kind === 'canonical' && prev.slotMapCsv) Object.assign(source, { slotMapCsv: prev.slotMapCsv, slotMapName: prev.slotMapName });
        s.timetable = source;
        s.chosen = null;
      });
    } catch (err) {
      status.textContent = '';
      alert(err instanceof LoadError ? err.message : `Could not read ${f.name}: ${(err as Error).message}`);
    }
  };
  const onSlotFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    const cur = store.state.timetable;
    if (!f || !cur) return;
    try {
      if (cur.kind === 'university') {
        const gridRows = await loadSlotGridFile(f);
        store.update((s) => void (s.timetable = { ...(s.timetable as typeof cur), gridRows, gridName: f.name }));
      } else {
        const text = await f.text();
        store.update((s) => void (s.timetable = { ...(s.timetable as typeof cur), slotMapCsv: text, slotMapName: f.name }));
      }
    } catch (err) {
      alert(err instanceof LoadError ? err.message : `Could not read ${f.name}: ${(err as Error).message}`);
    }
  };
  const slotLabel =
    tt?.kind === 'university'
      ? tt.gridName
        ? 'Replace slot timetable (.docx)'
        : 'Use a different slot timetable (.docx)'
      : tt?.slotMapName
        ? 'Replace slot map'
        : 'Add slot map (optional)';
  const sourceLine =
    tt?.kind === 'university'
      ? ` · slot times from ${tt.gridName ?? 'the built-in Fall 2026-27 slot timetable'}`
      : tt?.slotMapName
        ? ` + slot map ${tt.slotMapName}`
        : '';
  return h(
    'section',
    { class: 'card' },
    h('h2', null, '1 · Import timetable'),
    h(
      'p',
      { class: 'muted' },
      'Upload the Course Registration File exactly as the university publishes it (.xlsx, or a .csv saved from it). Slot names are turned into real times with the slot timetable; the Fall 2026-27 one is built in. Files are read in your browser and never uploaded.',
    ),
    h(
      'div',
      { class: 'row wrap' },
      h('label', { class: 'btn' }, 'Choose registration file', h('input', { type: 'file', accept: '.xlsx,.xls,.ods,.csv,.tsv,.txt', hidden: true, onchange: onTimetable })),
      tt ? h('label', { class: 'btn secondary' }, slotLabel, h('input', { type: 'file', accept: tt.kind === 'university' ? '.docx' : '.csv,.tsv,.txt', hidden: true, onchange: onSlotFile })) : null,
      tt?.kind === 'university' && tt.gridName
        ? h('button', { class: 'btn ghost', onclick: () => store.update((s) => void (s.timetable = { ...(s.timetable as typeof tt), gridRows: undefined, gridName: undefined })) }, 'Use built-in slot times')
        : null,
      h(
        'button',
        {
          class: 'btn secondary',
          onclick: () =>
            store.update((s) => {
              s.timetable = { kind: 'canonical', csv: sampleCsv, fileName: 'sample-timetable.csv (synthetic)' };
              s.selected = [];
              s.unavailable = [];
              s.chosen = null;
            }),
        },
        'Load synthetic sample',
      ),
      tt ? h('button', { class: 'btn ghost', onclick: () => confirm('Remove the loaded timetable?') && store.update((s) => void ((s.timetable = null), (s.chosen = null))) }, 'Clear') : null,
    ),
    status,
    tt ? h('p', null, h('strong', null, tt.fileName), sourceLine, p && !p.fatal ? ` — ${p.courses.length} courses, ${p.sectionsById.size} sections` : '') : null,
    p?.fatal ? h('p', { class: 'error' }, p.fatal) : null,
    p?.stats ? statsView(p) : null,
    p && p.errors.length ? issueList('error', `${p.errors.length} error(s)`, p.errors) : null,
    p && p.warnings.length ? issueList('warn', `${p.warnings.length} warning(s) — check these rows on the portal`, p.warnings) : null,
    p?.gridNotes?.length ? issueList('note', 'How the slot times were read', p.gridNotes) : null,
  );
}

function statsView(p: Parsed): HTMLElement {
  const st = p.stats!;
  return h(
    'div',
    { class: 'small' },
    h(
      'p',
      null,
      `${st.totalRows} rows read: ${st.dataRows} course rows (${st.importedRows} imported`,
      st.timesUnknown.length ? h('span', { class: 'warn' }, `, ${st.timesUnknown.length} of them with times unknown`) : '',
      ', ',
      h('span', { class: st.skipped.length ? 'error' : '' }, `${st.skipped.length} skipped`),
      `), ${st.headerRows.length} table headers, ${st.headingRows.length} sub-headings, ${st.blankRows} blank.`,
      st.normalizations.length ? ` ${st.normalizations.length} slot spellings were corrected.` : '',
    ),
    st.timesUnknown.length
      ? issueList(
          'warn',
          `${st.timesUnknown.length} row(s) with class times not in the file — selectable, but never counted as clash-free`,
          st.timesUnknown.map((x) => `Row ${x.row} ${x.code}: ${x.reason}`),
        )
      : null,
    st.skipped.length
      ? issueList(
          'error',
          `${st.skipped.length} row(s) skipped — these offerings are not in the planner`,
          st.skipped.map((x) => `Row ${x.row} ${x.code}: ${x.reason}`),
        )
      : null,
    st.normalizations.length
      ? issueList(
          'fix',
          `${st.normalizations.length} slot spelling(s) corrected`,
          st.normalizations.map((x) => `Row ${x.row} ${x.code}: "${x.from}" read as ${x.to} (${x.why}; ${x.confidence} confidence)`),
        )
      : null,
  );
}

function issueList(kind: 'error' | 'warn' | 'fix' | 'note', title: string, items: string[]): HTMLElement {
  return details(`issues-${kind}-${title.replace(/\d+/g, '')}`, { class: `issues ${kind}` }, false, h('summary', null, title), h('ul', null, items.slice(0, 200).map((i) => h('li', null, i))), items.length > 200 ? h('p', null, `…and ${items.length - 200} more`) : null);
}

function coursePicker(store: Store, p: Parsed): HTMLElement {
  const sel = new Set(store.state.selected);
  const credits = selectedCourses(store).reduce((t, c) => t + c.credits, 0);
  const over = credits > store.state.maxCredits;
  const list = h('ul', { class: 'course-list' });
  const fill = () => {
    list.replaceChildren();
    const q = courseFilter.trim().toLowerCase();
    for (const c of p.courses) {
      if (q && !`${c.code} ${c.title}`.toLowerCase().includes(q)) continue;
      const nSec = c.components.map((x) => x.sections.length).join('+');
      const cat = [c.category, c.audience].filter(Boolean).join(' · ');
      list.append(
        h(
          'li',
          null,
          h(
            'label',
            { class: 'check' },
            h('input', {
              type: 'checkbox',
              checked: sel.has(c.code),
              onchange: (e: Event) =>
                store.update((s) => {
                  const on = (e.target as HTMLInputElement).checked;
                  s.selected = on ? [...s.selected, c.code] : s.selected.filter((x) => x !== c.code);
                }),
            }),
            h('span', { class: 'code' }, c.code),
            h('span', { class: 'title' }, c.title),
            h('span', { class: 'meta' }, `${c.credits} cr · ${c.type} · ${nSec} sec${cat ? ' · ' + cat : ''}`),
            c.components.some((x) => x.sections.some((y) => y.timesUnknown !== undefined)) ? h('span', { class: 'badge warn' }, 'times unknown') : null,
          ),
        ),
      );
    }
  };
  fill();
  const missing = store.state.selected.filter((c) => !p.byCode.has(c));
  return h(
    'section',
    { class: 'card' },
    h('h2', null, '2 · Pick courses'),
    h('input', {
      type: 'search',
      placeholder: 'Filter by code or title…',
      value: courseFilter,
      oninput: (e: Event) => {
        courseFilter = (e.target as HTMLInputElement).value;
        fill();
      },
    }),
    list,
    missing.length ? h('p', { class: 'warn' }, `Previously selected but not in this file: ${missing.join(', ')}`) : null,
    h(
      'div',
      { class: 'row wrap credits' + (over ? ' over' : '') },
      h('strong', null, `Selected: ${store.state.selected.length - missing.length} courses, ${credits} credits`),
      h(
        'label',
        null,
        'Max credits ',
        h('input', { type: 'number', min: 0, step: 0.5, value: store.state.maxCredits, class: 'narrow', onchange: (e: Event) => store.update((s) => void (s.maxCredits = Number((e.target as HTMLInputElement).value) || 0)) }),
      ),
      over ? h('span', { class: 'badge danger' }, `Over the limit by ${credits - store.state.maxCredits}`) : null,
    ),
  );
}

function sectionsCard(store: Store, _p: Parsed): HTMLElement {
  const unavailable = new Set(store.state.unavailable);
  const toggle = (id: string, on: boolean) =>
    store.update((s) => {
      s.unavailable = on ? s.unavailable.filter((x) => x !== id) : [...s.unavailable, id];
    });
  return h(
    'section',
    { class: 'card' },
    h('h2', null, '3 · Sections'),
    h('p', { class: 'muted' }, 'Untick a section that is full or missing on the live portal. Results update immediately.'),
    selectedCourses(store).map((c) =>
      details(
        `sec-${c.code}`,
        { class: 'sections' },
        false,
        h('summary', null, h('span', { class: 'code' }, c.code), ` ${c.title} `, h('span', { class: 'muted' }, `(${c.components.reduce((t, x) => t + x.sections.filter((s) => !unavailable.has(s.id)).length, 0)} available)`)),
        c.components.map((comp) =>
          h(
            'div',
            null,
            c.components.length > 1 ? h('h4', null, `${comp.name} — pick one`) : null,
            h(
              'ul',
              { class: 'plain' },
              comp.sections.map((s) =>
                h(
                  'li',
                  { class: unavailable.has(s.id) ? 'struck' : '' },
                  h(
                    'label',
                    { class: 'check' },
                    h('input', { type: 'checkbox', checked: !unavailable.has(s.id), onchange: (e: Event) => toggle(s.id, (e.target as HTMLInputElement).checked) }),
                    h('strong', null, s.section),
                    h('span', null, describeSection(s)),
                    sectionCaveats(s).map((w) => h('span', { class: 'caveat' }, `⚠ ${w.replace(`${s.courseCode}: `, '')}`)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    store.state.unavailable.length
      ? h('button', { class: 'btn ghost', onclick: () => store.update((s) => void (s.unavailable = [])) }, `Reset ${store.state.unavailable.length} unavailable section(s)`)
      : null,
  );
}

function describeSection(s: Section): string {
  const known = s.meetings.map(formatMeeting).join(', ');
  const parts = [s.timesUnknown !== undefined ? known || 'no times in the file' : known || 'no scheduled class'];
  if (s.slots.length) parts.push(`slots ${s.slots.join(', ')}`);
  if (s.faculty) parts.push(s.faculty);
  if (s.rows?.length) parts.push(`${s.rows.length > 1 ? 'rows' : 'row'} ${s.rows.join(', ')} of the file`);
  return parts.join(' · ');
}

const SORTS: Record<string, [string, (a: ComboStats, b: ComboStats) => number]> = {
  default: ['File order', () => 0],
  days: ['Fewest days on campus', (a, b) => a.days - b.days || a.gapMinutes - b.gapMinutes],
  gaps: ['Fewest idle gaps', (a, b) => a.gapMinutes - b.gapMinutes || a.days - b.days],
  start: ['Latest first class', (a, b) => (b.earliestStart ?? 0) - (a.earliestStart ?? 0)],
  end: ['Earliest last class', (a, b) => (a.latestEnd ?? 0) - (b.latestEnd ?? 0)],
};

function resultsCard(store: Store, p: Parsed): HTMLElement {
  const courses = selectedCourses(store);
  const { result, stats } = solveFor(store, courses);
  const card = h('section', { class: 'card' }, h('h2', null, '4 · Clash-free combinations'));
  if (result.selfClashing.length)
    card.append(
      h(
        'p',
        { class: 'warn' },
        `Left out because their own class times overlap (check on the portal): ${result.selfClashing.map((s) => `${s.courseCode} ${s.section}`).join(', ')}`,
      ),
    );
  if (result.count === 0) {
    card.append(diagnosisView(result, p));
    return card;
  }
  const order = result.combinations.map((_, i) => i);
  const cmp = SORTS[store.state.sortBy][1];
  const unknown = result.combinations.map(hasUnknownTimes);
  // Fully verified combinations first; ones relying on unknown times after.
  order.sort((a, b) => Number(unknown[a]) - Number(unknown[b]) || cmp(stats[a], stats[b]) || a - b);
  card.append(
    h(
      'div',
      { class: 'row wrap' },
      h(
        'strong',
        { class: result.clashFreeCount ? 'ok' : 'warn' },
        `${result.countCapped ? 'At least ' : ''}${result.clashFreeCount.toLocaleString()} clash-free combination${result.clashFreeCount === 1 ? '' : 's'}`,
      ),
      h(
        'label',
        null,
        'Sort ',
        h(
          'select',
          { onchange: (e: Event) => store.update((s) => void (s.sortBy = (e.target as HTMLSelectElement).value as typeof s.sortBy)) },
          Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k, selected: store.state.sortBy === k }, label)),
        ),
      ),
    ),
  );
  if (result.unknownTimesCount)
    card.append(
      h(
        'p',
        { class: 'warn' },
        `${result.unknownTimesCount.toLocaleString()} more combination${result.unknownTimesCount === 1 ? '' : 's'} include a section whose class times are not in the university file. They have no known clash but are NOT verified clash-free: ${TIMES_UNKNOWN}.`,
      ),
    );
  if (result.truncated)
    card.append(h('p', { class: 'muted' }, `Showing and sorting the first ${result.combinations.length.toLocaleString()} found. Mark sections unavailable to narrow it down.`));
  const chosenKey = store.state.chosen?.slice().sort().join(',');
  const list = h('ol', { class: 'combos' });
  for (const i of order.slice(0, shown)) {
    const combo = result.combinations[i];
    const st = stats[i];
    const key = combo.map((s) => s.id).sort().join(',');
    list.append(
      h(
        'li',
        { class: key === chosenKey ? 'active' : '' },
        h(
          'div',
          { class: 'combo-head' },
          h('span', null, combo.map((s) => h('span', { class: 'pill', style: { borderColor: colorFor(s.courseCode, store.state.selected) } }, `${s.courseCode} ${s.component === 'main' ? '' : s.component + ' '}${s.section}`))),
          h('button', { class: 'btn small', onclick: () => store.update((s) => void (s.chosen = combo.map((x) => x.id))) }, key === chosenKey ? 'Viewing' : 'View'),
        ),
        h('div', { class: 'muted small' }, `${st.days} days · ${Math.round(st.gapMinutes)} min gaps · ${st.earliestStart !== null ? formatTime(st.earliestStart) : '—'}–${st.latestEnd !== null ? formatTime(st.latestEnd) : '—'}`),
        combo.flatMap(sectionCaveats).map((w) => h('div', { class: 'caveat' }, `⚠ ${w}`)),
      ),
    );
  }
  card.append(list);
  if (order.length > shown)
    card.append(
      h('button', {
        class: 'btn ghost',
        onclick: () => {
          shown += PAGE;
          store.update(() => {});
        },
      }, `Show ${Math.min(PAGE, order.length - shown)} more`),
    );
  return card;
}

function diagnosisView(result: SolveResult, p: Parsed): HTMLElement {
  const d = result.diagnosis!;
  const title = (code: string) => `${code} (${p.byCode.get(code)?.title ?? ''})`;
  return h(
    'div',
    { class: 'diagnosis' },
    h('p', { class: 'error' }, h('strong', null, 'No clash-free combination exists for this selection.')),
    d.emptyComponents.length
      ? h('div', null, h('h4', null, 'No section left'), h('ul', null, d.emptyComponents.map((e) => h('li', null, `${title(e.courseCode)}${e.component === 'main' ? '' : ' — ' + e.component}: every section is marked unavailable (${e.unavailableSections.join(', ')})`))))
      : null,
    d.firstBreaking ? h('p', null, 'Adding courses in the order you picked them, it becomes impossible at ', h('strong', null, title(d.firstBreaking)), '.') : null,
    d.culprits.length ? h('p', null, 'Dropping any one of these makes the rest fit: ', h('strong', null, d.culprits.join(', ')), '.') : h('p', null, 'No single course can be dropped to fix it — at least two must change.'),
    d.pairwise.length ? h('div', null, h('h4', null, 'Pairs that can never be taken together'), h('ul', null, d.pairwise.map((x) => h('li', null, `${x.a} ✕ ${x.b}`)))) : null,
    h('h4', null, `Smallest conflicting group: ${d.minimalConflict.join(', ')}`),
    d.blockingClashes.length
      ? details(
          'blocking',
          null,
          d.blockingClashes.length <= 12,
          h('summary', null, `${d.blockingClashes.length} section clash(es) in that group`),
          h(
            'ul',
            { class: 'small' },
            d.blockingClashes.map((c) => h('li', null, `${c.a.courseCode} ${c.a.section} ✕ ${c.b.courseCode} ${c.b.section}: ${c.pairs.map(([x, y]) => `${formatMeeting(x)} vs ${formatTime(y.start)}–${formatTime(y.end)}`).join('; ')}`)),
          ),
        )
      : null,
  );
}

/** Returns the chosen combination if it is still valid for the current selection. */
function validChosen(store: Store, p: Parsed): Section[] | null {
  const ids = store.state.chosen;
  if (!ids) return null;
  const secs = ids.map((id) => p.sectionsById.get(id));
  if (secs.some((s) => !s)) return null;
  const combo = secs as Section[];
  const unavailable = new Set(store.state.unavailable);
  if (combo.some((s) => unavailable.has(s.id))) return null;
  const needed = selectedCourses(store).flatMap((c) => c.components.map((x) => `${c.code}|${x.name}`));
  const have = combo.map((s) => `${s.courseCode}|${s.component}`);
  if (needed.length !== have.length || needed.some((n) => !have.includes(n))) return null;
  if (findClashes(combo).length) return null;
  return combo;
}

function chosenCard(store: Store, p: Parsed): HTMLElement | null {
  if (!store.state.chosen) return null;
  const combo = validChosen(store, p);
  if (!combo)
    return h('section', { class: 'card' }, h('h2', null, '5 · Your timetable'), h('p', { class: 'warn' }, 'The combination you picked earlier no longer matches your selection or available sections. Pick one from the list above.'));
  const courses = selectedCourses(store);
  const text = comboText(combo, courses);
  const credits = courses.reduce((t, c) => t + c.credits, 0);
  return h(
    'section',
    { class: 'card' },
    h('h2', null, '5 · Your timetable'),
    hasUnknownTimes(combo) ? h('p', { class: 'warn' }, h('strong', null, 'Not verified clash-free.'), ' Some class times are not in the university file — verify on the portal.') : null,
    combo.flatMap(sectionCaveats).length ? h('ul', { class: 'caveats' }, combo.flatMap(sectionCaveats).map((w) => h('li', null, `⚠ ${w}`))) : null,
    h('p', null, `${credits} credits`, credits > store.state.maxCredits ? h('span', { class: 'badge danger' }, ` over max ${store.state.maxCredits}`) : ''),
    gridView(combo, store.state.selected, p),
    h(
      'div',
      { class: 'row wrap' },
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            const canvas = document.createElement('canvas');
            drawGrid(canvas, combo, courses);
            canvas.toBlob((b) => b && download('timetable.png', b));
          },
        },
        'Download PNG',
      ),
      h('button', { class: 'btn secondary', onclick: () => download('timetable.txt', text) }, 'Download text list'),
      h(
        'button',
        {
          class: 'btn secondary',
          onclick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            try {
              await navigator.clipboard.writeText(text);
              btn.textContent = 'Copied';
            } catch {
              btn.textContent = 'Copy failed — use download';
            }
          },
        },
        'Copy text list',
      ),
    ),
    h('pre', { class: 'textlist' }, text),
  );
}

function gridView(combo: Section[], codes: string[], p: Parsed): HTMLElement {
  const { days, startMin, endMin } = gridLayout(combo);
  const px = 0.9;
  const height = (endMin - startMin) * px;
  const hours: number[] = [];
  for (let t = startMin; t <= endMin; t += 60) hours.push(t);
  const cols = days.map((d) =>
    h(
      'div',
      { class: 'tt-day' },
      h('div', { class: 'tt-dayhead' }, d),
      h(
        'div',
        { class: 'tt-body', style: { height: `${height}px` } },
        hours.map((t) => h('div', { class: 'tt-line', style: { top: `${(t - startMin) * px}px` } })),
        combo.flatMap((s) =>
          s.meetings
            .filter((m) => m.day === d)
            .map((m) =>
              h(
                'div',
                {
                  class: 'tt-block',
                  title: `${s.courseCode} ${p.byCode.get(s.courseCode)?.title ?? ''}\nSection ${s.section}\n${formatMeeting(m)}${m.slot ? '\nSlot ' + m.slot : ''}`,
                  style: { top: `${(m.start - startMin) * px}px`, height: `${(m.end - m.start) * px - 2}px`, background: colorFor(s.courseCode, codes) },
                },
                h('b', null, `${s.courseCode} ${s.section}`),
                h('span', null, `${formatTime(m.start)}–${formatTime(m.end)}`),
              ),
            ),
        ),
      ),
    ),
  );
  const unscheduled = combo.filter((s) => !s.meetings.length && s.timesUnknown === undefined);
  const unknownTimes = combo.filter((s) => s.timesUnknown !== undefined);
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'tt-scroll' },
      h(
        'div',
        { class: 'tt', style: { gridTemplateColumns: `44px repeat(${days.length}, minmax(84px, 1fr))` } },
        h('div', { class: 'tt-gutter' }, h('div', { class: 'tt-dayhead' }), h('div', { class: 'tt-body', style: { height: `${height}px` } }, hours.map((t) => h('span', { class: 'tt-hour', style: { top: `${(t - startMin) * px}px` } }, formatTime(t))))),
        cols,
      ),
    ),
    unscheduled.length ? h('p', { class: 'muted small' }, `No scheduled class: ${unscheduled.map((s) => `${s.courseCode} (${s.section})`).join(', ')}`) : null,
    unknownTimes.length ? h('p', { class: 'warn small' }, `Not shown in the grid (${TIMES_UNKNOWN}): ${unknownTimes.map((s) => `${s.courseCode} (${s.section})`).join(', ')}`) : null,
  );
}

