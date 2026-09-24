type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/**
 * Tiny element builder. Text is always set via text nodes (never innerHTML), so content
 * from uploaded files cannot inject markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(digits);
}

const openDetails = new Set<string>();

/** <details> whose open/closed state survives re-renders. `defaultOpen` applies until the user toggles it. */
export function details(key: string, props: Props | null, defaultOpen: boolean, ...children: (Child | Child[])[]): HTMLDetailsElement {
  const known = openDetails.has(key) || openDetails.has(`!${key}`);
  const el = h('details', { ...props, open: known ? openDetails.has(key) : defaultOpen }, ...children);
  el.addEventListener('toggle', () => {
    openDetails.delete(key);
    openDetails.delete(`!${key}`);
    openDetails.add(el.open ? key : `!${key}`);
  });
  return el;
}
