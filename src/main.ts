import './style.css';
import { h } from './ui/dom';
import { Store } from './ui/store';
import { renderPlanner } from './ui/planner';
import { renderProgress } from './ui/progress';
import { renderCgpa } from './ui/cgpa';
import { download } from './export';
import { normalizeState } from './state';

type Tab = 'planner' | 'progress' | 'cgpa';
const TABS: [Tab, string][] = [
  ['planner', 'Planner'],
  ['progress', 'Degree progress'],
  ['cgpa', 'CGPA'],
];

const store = new Store();
let tab: Tab = (() => {
  try {
    const t = localStorage.getItem('tccp.tab') as Tab | null;
    return t && TABS.some(([k]) => k === t) ? t : 'planner';
  } catch {
    return 'planner';
  }
})();

const root = document.getElementById('app')!;

function render() {
  const scrollY = window.scrollY;
  const view = tab === 'planner' ? renderPlanner(store) : tab === 'progress' ? renderProgress(store) : renderCgpa(store);
  root.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('h1', null, 'Registration & CGPA Planner'),
      h('p', { class: 'disclaimer' }, 'Unofficial student tool. Not affiliated with or endorsed by the university. Always verify sections, slots and credits on the official portal. Everything stays in your browser.'),
      h(
        'nav',
        { class: 'tabs', role: 'tablist' },
        TABS.map(([k, label]) =>
          h(
            'button',
            {
              role: 'tab',
              'aria-selected': String(k === tab),
              class: k === tab ? 'active' : '',
              onclick: () => {
                tab = k;
                try {
                  localStorage.setItem('tccp.tab', k);
                } catch {
                  /* per-viewer convenience only */
                }
                render();
                window.scrollTo(0, 0);
              },
            },
            label,
          ),
        ),
      ),
    ),
    h('main', null, view),
    h(
      'footer',
      null,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn secondary', onclick: () => download('registration-plan.json', JSON.stringify(store.state, null, 2), 'application/json') }, 'Export plan (JSON)'),
        h(
          'label',
          { class: 'btn secondary' },
          'Import plan',
          h('input', {
            type: 'file',
            accept: '.json,application/json',
            hidden: true,
            onchange: async (e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                const next = normalizeState(JSON.parse(await f.text()));
                if (confirm('Replace your current plan with the imported one?')) store.replace(next);
              } catch (err) {
                alert(`Could not import plan: ${(err as Error).message}`);
              }
            },
          }),
        ),
        h('button', { class: 'btn ghost', onclick: () => confirm('Erase everything saved in this browser?') && store.replace(normalizeState({ version: 1 })) }, 'Reset all'),
      ),
      store.persisted ? null : h('p', { class: 'warn small' }, 'Browser storage is unavailable, so your plan will not survive a reload. Use "Export plan" to keep it.'),
      h('p', { class: 'muted small' }, 'Open source · no accounts · no tracking · no data leaves your device.'),
    ),
  );
  window.scrollTo(0, scrollY);
}

store.onChange(render);
render();
