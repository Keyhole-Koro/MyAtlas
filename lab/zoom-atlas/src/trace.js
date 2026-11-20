// The recorded run (traces[0]) replayed on the map: what each event says, and a thread timeline.
import { TRACE, NODES } from './model.js';
import { T, alpha } from './theme.js';
import { F, fontStr } from './text.js';

export const EVENTS = TRACE ? TRACE.events : [];
export const MAX_INSTR = EVENTS.length ? EVENTS[EVENTS.length - 1].instr : 1;
// Threads in the order the timeline shows them, with names cut from the data's own names.
export const THREADS = TRACE ? Object.keys(TRACE.threads).map(Number).sort((a, b) => (b === 3) - (a === 3) || a - b) : [];
export function threadShort(t) {
  const name = TRACE.threads[t] || String(t);
  if (t === -1) return 'idle';
  return name.replace(/^kernel:\s*/, '');
}
export function threadColor(t) {
  if (t === -1) return T['text-3'];
  const name = TRACE.threads[t] || '';
  if (/compositor/.test(name)) return T['run-svc'];
  if (/automation/.test(name)) return T['syn-kw'];
  return T['run-app'];
}
// The last event at or before i that belongs to a node.
export function nodeEventAt(i) {
  for (let j = i; j >= 0; j--) if (EVENTS[j].n && NODES[EVENTS[j].n]) return j;
  return -1;
}
export const NODE_EVENTS = EVENTS.map((e, i) => (e.n && NODES[e.n] ? i : -1)).filter((i) => i >= 0);

// One event as a sentence (from the event's own fields).
export function describe(e) {
  switch (e.ev) {
    case 'enter': return { what: `${e.fn} に入る`, mono: true };
    case 'irq': return { what: `割り込み：${(e.cause || []).join('・')}${e.service ? `（${e.service}）` : ''}` };
    case 'switch': return { what: `スレッドを切り替える → ${TRACE.threads[e.thread]}` };
    case 'request': return { what: `自動操作の要求：${e.method}`, mono: false };
    default: return { what: e.ev };
  }
}

// Lanes per thread; ticks at the instruction count; the current event marked.
export function drawTimeline(cv, cur) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const labelW = labelWidth(w), laneH = Math.min(15, (h - 18) / THREADS.length), x0 = labelW, x1 = w - 6;
  const X = (instr) => x0 + (x1 - x0) * (instr / MAX_INSTR);
  c.font = fontStr(F.sans, 12);
  c.textBaseline = 'middle';
  THREADS.forEach((t, li) => {
    const y = li * laneH;
    c.fillStyle = T['surface-2'];
    c.fillRect(x0, y + 1, x1 - x0, laneH - 2);
    c.fillStyle = T['text-2'];
    // a thread's name, cut at a word end with … when the lane label is narrow
    let name = threadShort(t);
    while (name.length > 3 && c.measureText(name).width > labelW - 10) name = name.replace(/[._]?[^._]*…?$/, '') + '…';
    c.fillText(name, 4, y + laneH / 2 + 1);
  });
  // who ran when: from each event to the next, on the event's thread
  for (let i = 0; i < EVENTS.length; i++) {
    const e = EVENTS[i], next = EVENTS[i + 1];
    const li = THREADS.indexOf(e.thread);
    if (li < 0) continue;
    const a = X(e.instr), b = next ? X(next.instr) : x1;
    c.fillStyle = alpha(threadColor(e.thread), i <= cur ? 0.55 : 0.22);
    c.fillRect(a, li * laneH + 3, Math.max(1, b - a), laneH - 6);
  }
  // node events as ticks
  for (const i of NODE_EVENTS) {
    const e = EVENTS[i], li = THREADS.indexOf(e.thread);
    if (li < 0) continue;
    c.fillStyle = i <= cur ? T.text : T['text-3'];
    c.fillRect(Math.round(X(e.instr)), li * laneH + 1, 1, laneH - 2);
  }
  // axis
  const axisY = THREADS.length * laneH + 3;
  c.fillStyle = T['text-3'];
  c.font = fontStr(F.sans, 11.5);
  c.textBaseline = 'top';
  c.fillText('0', x0, axisY);
  const endLabel = `${MAX_INSTR.toLocaleString('ja-JP')} 命令`;
  c.textAlign = 'right'; c.fillText(endLabel, x1, axisY); c.textAlign = 'left';
  // the current event
  if (cur >= 0 && EVENTS[cur]) {
    const x = X(EVENTS[cur].instr);
    c.fillStyle = T.accent;
    c.fillRect(Math.round(x) - 1, 0, 2, THREADS.length * laneH);
    c.beginPath(); c.moveTo(x - 5, 0); c.lineTo(x + 5, 0); c.lineTo(x, 6); c.closePath(); c.fill();
  }
  return { x0, x1, laneH };
}
// The event nearest to a point on the timeline.
const labelWidth = (w) => (w < 480 ? 96 : 132);
export function eventAtX(cv, px) {
  const w = cv.clientWidth, x0 = labelWidth(w), x1 = w - 6;
  const instr = ((px - x0) / (x1 - x0)) * MAX_INSTR;
  let best = 0, bd = Infinity;
  EVENTS.forEach((e, i) => { const d = Math.abs(e.instr - instr); if (d < bd) { bd = d; best = i; } });
  return best;
}
