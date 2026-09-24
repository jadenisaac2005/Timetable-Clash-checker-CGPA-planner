import { DAYS, type Course, type Day, type Section } from './core/model';
import { formatMeeting, formatTime } from './core/time';

export const TIMES_UNKNOWN = 'times unknown — verify on the portal';

/** Everything a student must double-check about a section, in plain words. */
export function sectionCaveats(s: Section): string[] {
  return [...(s.timesUnknown !== undefined ? [`${s.courseCode}: ${TIMES_UNKNOWN} (${s.timesUnknown})`] : []), ...(s.warnings ?? []).map((w) => `${s.courseCode}: ${w}`)];
}

export function courseByCode(courses: readonly Course[]): Map<string, Course> {
  return new Map(courses.map((c) => [c.code, c]));
}

/** Plain-text list for filling the official registration form. */
export function comboText(combo: readonly Section[], courses: readonly Course[]): string {
  const byCode = courseByCode(courses);
  const lines: string[] = [];
  let credits = 0;
  const counted = new Set<string>();
  for (const s of combo) {
    const c = byCode.get(s.courseCode);
    if (c && !counted.has(c.code)) {
      credits += c.credits;
      counted.add(c.code);
    }
    const comp = s.component === 'main' ? '' : ` (${s.component})`;
    const slots = s.slots.length ? s.slots.join(', ') : '—';
    const known = s.meetings.map(formatMeeting).join('; ');
    const times = s.timesUnknown !== undefined ? [known, TIMES_UNKNOWN].filter(Boolean).join('; ') : known || 'no scheduled class';
    const flag = s.warnings?.length ? '\t(low-confidence slot reading — verify on the portal)' : '';
    lines.push(`${s.courseCode}\t${c?.title ?? ''}\tSection ${s.section}${comp}\tSlots: ${slots}\t${times}${flag}`);
  }
  lines.push('', `Total credits: ${credits}`);
  if (combo.some((s) => s.timesUnknown !== undefined)) lines.push('NOT verified clash-free: some class times are not in the university file.');
  lines.push('Unofficial plan — verify every section on the university portal before submitting.');
  return lines.join('\n');
}

export const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4f46e5', '#0d9488', '#b45309', '#7c3aed'];

export function colorFor(code: string, codes: readonly string[]): string {
  const i = codes.indexOf(code);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

export interface GridLayout {
  days: Day[];
  startMin: number;
  endMin: number;
}

export function gridLayout(combo: readonly Section[]): GridLayout {
  const ms = combo.flatMap((s) => s.meetings);
  const used = new Set(ms.map((m) => m.day));
  const days = DAYS.filter((d, i) => i < 5 || used.has(d));
  if (!ms.length) return { days, startMin: 9 * 60, endMin: 17 * 60 };
  const startMin = Math.floor(Math.min(...ms.map((m) => m.start)) / 60) * 60;
  const endMin = Math.ceil(Math.max(...ms.map((m) => m.end)) / 60) * 60;
  return { days, startMin, endMin };
}

/** Draw the weekly grid onto a canvas (no DOM screenshot dependency). */
export function drawGrid(canvas: HTMLCanvasElement, combo: readonly Section[], courses: readonly Course[], scale = 2): void {
  const { days, startMin, endMin } = gridLayout(combo);
  const codes = [...new Set(combo.map((s) => s.courseCode))];
  const unscheduled = combo.filter((s) => !s.meetings.length && s.timesUnknown === undefined);
  const caveats = combo.flatMap(sectionCaveats);
  const colW = 170, gutter = 56, head = 34, pxPerMin = 1.1;
  const bodyH = (endMin - startMin) * pxPerMin;
  const footer = 28 + (unscheduled.length ? 22 : 0) + caveats.length * 18;
  const W = gutter + colW * days.length + 12;
  const H = head + bodyH + footer;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111827';
  days.forEach((d, i) => ctx.fillText(d, gutter + i * colW + 8, head / 2));
  ctx.font = '11px system-ui, sans-serif';
  for (let t = startMin; t <= endMin; t += 60) {
    const y = head + (t - startMin) * pxPerMin;
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.moveTo(gutter, y);
    ctx.lineTo(W - 12, y);
    ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.fillText(formatTime(t), 8, y);
  }
  days.forEach((_, i) => {
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.moveTo(gutter + i * colW, head);
    ctx.lineTo(gutter + i * colW, head + bodyH);
    ctx.stroke();
  });
  const byCode = courseByCode(courses);
  for (const s of combo)
    for (const m of s.meetings) {
      const x = gutter + days.indexOf(m.day) * colW + 3;
      const y = head + (m.start - startMin) * pxPerMin + 1;
      const h = (m.end - m.start) * pxPerMin - 2;
      ctx.fillStyle = colorFor(s.courseCode, codes);
      roundRect(ctx, x, y, colW - 6, h, 5);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, colW - 6, h);
      ctx.clip();
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(`${s.courseCode} · ${s.section}`, x + 6, y + 11);
      ctx.font = '11px system-ui, sans-serif';
      if (h > 30) ctx.fillText(`${formatTime(m.start)}–${formatTime(m.end)}${m.slot ? ' · ' + m.slot : ''}`, x + 6, y + 26);
      if (h > 46) ctx.fillText(byCode.get(s.courseCode)?.title ?? '', x + 6, y + 40);
      ctx.restore();
    }
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui, sans-serif';
  let fy = head + bodyH + 16;
  if (unscheduled.length) {
    ctx.fillText(`No scheduled class: ${unscheduled.map((s) => `${s.courseCode} (${s.section})`).join(', ')}`, 8, fy);
    fy += 22;
  }
  ctx.fillStyle = '#b45309';
  for (const c of caveats) {
    ctx.fillText(`⚠ ${c}`, 8, fy);
    fy += 18;
  }
  ctx.fillStyle = '#374151';
  ctx.fillText('Unofficial plan — verify on the university portal.', 8, fy);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function download(filename: string, data: Blob | string, type = 'text/plain'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
