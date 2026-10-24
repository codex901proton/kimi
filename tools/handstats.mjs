// Naturalness metrics for the hand animation over the whole piece.
import { buildPerformance } from '../src/perform.js';
import { makeHandAnimator } from '../src/render/handanim.js';
import { keyX } from '../src/keyboard.js';
const perf = buildPerformance();
const keyNotes = Array.from({ length: 128 }, () => []);
for (const n of perf.notes) keyNotes[n.midi].push(n);
for (const l of keyNotes) l.sort((a, b) => a.on - b.on);
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
for (const h of ['L', 'R']) {
  const a = makeHandAnimator(perf, h, keyNotes);
  const st = { n: 0, c: 0, hyper: 0, hyperC: 0, curl: 0, miss: 0, mcp: [], pip: [], speed: [], acc: [], tipBelow: 0 };
  let prev = null, prevV = null;
  const bad = [];
  for (let t = a.firstT; t < a.lastUp; t += 1 / 60) {
    const sk = a.skeleton(t);
    for (let f = 2; f <= 5; f++) {
      const F = sk.fingers[f]; st.n++;
      st.mcp.push(F.flex[0]); st.pip.push(F.flex[1]);
      if (F.flex[0] < -0.08) { st.hyper++; if (F.contact) st.hyperC++; if (bad.length < 6 && F.contact) bad.push(`${t.toFixed(2)}f${f}:${F.flex[0].toFixed(2)}`); }
      if (F.flex[1] > 1.3) st.curl++;
      if (F.contact) { st.c++; const tip = F.pts[3]; if (Math.hypot(tip[0] - keyX(F.note.midi), tip[1] - F.note.cy) > 6) st.miss++; }
      if (F.pts[3][2] < -2) st.tipBelow++;
    }
    const p = [sk.H.x, sk.H.y, sk.H.z];
    if (prev) { const v = p.map((x, i) => (x - prev[i]) * 60); st.speed.push(Math.hypot(...v)); if (prevV) st.acc.push(Math.hypot(...v.map((x, i) => (x - prevV[i]) * 60))); prevV = v; }
    prev = p;
  }
  const P = (x) => (100 * x / st.n).toFixed(1) + '%';
  console.log(`${h}: MCP hyperext ${P(st.hyper)} (in contact ${(100 * st.hyperC / st.c).toFixed(1)}%), PIP>1.3 ${P(st.curl)}, contact miss>6mm ${(100 * st.miss / st.c).toFixed(1)}%, tip below keys ${P(st.tipBelow)}`);
  console.log(`   MCP flex p10/50/90 ${[0.1, 0.5, 0.9].map((q) => pct(st.mcp, q).toFixed(2)).join('/')}  PIP p10/50/90 ${[0.1, 0.5, 0.9].map((q) => pct(st.pip, q).toFixed(2)).join('/')}  hand speed p50/p99 ${pct(st.speed, 0.5).toFixed(0)}/${pct(st.speed, 0.99).toFixed(0)} mm/s  acc p99 ${(pct(st.acc, 0.99) / 1000).toFixed(1)} m/s²`);
  if (bad.length) console.log('   e.g.', bad.join(' '));
}
