// Hand & finger kinematics.
// Each chord gets a hand pose found by optimising anatomical comfort (finger reach, splay,
// knuckle height, forearm alignment). Between poses the hand flows along a C¹ path; it holds
// still while a chord sounds and makes ballistic, arcing leaps when it must. Arm weight lifts
// and drops into loud chords. Fingers are solved with coupled inverse kinematics
// (DIP ≈ ⅔ PIP); the thumb has its own opposable chain.
import { keyX, keyTopZ, KEY_DIP, PIVOT_Y, BLACK_FRONT_Y, BLACK_TOP_W, BLACK_H, LOW, HIGH, isBlack, KEYBOARD_W } from '../keyboard.js';
import { contactRange } from '../hands.js';
import { clamp, lerp, minjerk, smoothstep, easeInQuad, noise1, lowerBound } from '../util.js';

const HS = 1.05; // a large hand (Rachmaninoff's were famously big)
const sc = (a) => a.map((v) => v * HS);
// Hand-local frame: origin at the middle-finger knuckle joint; x → little finger, y → fingertips, z → back of hand.
export const ANAT = {
  mcp: { 2: sc([-22, -1, -2]), 3: [0, 0, 0], 4: sc([19, -4, -2]), 5: sc([35, -13, -6]) },
  cmc: sc([-21, -63, -17]),
  wrist: sc([3, -90, -5]),
  len: { 1: sc([44, 31, 27]), 2: sc([45, 26, 21]), 3: sc([49, 30, 22]), 4: sc([46, 28, 21]), 5: sc([36, 21, 19]) },
  rad: { 1: sc([11.2, 8.9]), 2: sc([9.3, 7.3]), 3: sc([9.6, 7.5]), 4: sc([9.1, 7.1]), 5: sc([8.0, 6.4]) },
  abd: { 2: -0.1, 3: 0, 4: 0.07, 5: 0.16 },
  thumbRest: sc([-50, 22, -47]),       // relaxed thumb tip: on its side, nearer the key front
  thumbMeta: [-0.46, 0.85, -0.26],     // relaxed thumb metacarpal direction
  thumbNail: [-0.72, 0.06, 0.69],      // the thumb nail faces outward and up
};
const NAT = { mcp: 0.2, pip: 0.72, dip: 0.67 };
const BODY_X = KEYBOARD_W / 2;
const Z_NAT = 63;                       // knuckle-joint height above the white keys

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function handFrame(st, s) {
  const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
  const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  const F = [sy * cp, cy * cp, -sp];
  const U0 = [sy * sp, cy * sp, cp];
  const L0 = [s * cy, -s * sy, 0];
  const cr = Math.cos(st.roll), sr = Math.sin(st.roll);
  const L = [L0[0] * cr - U0[0] * sr, L0[1] * cr - U0[1] * sr, L0[2] * cr - U0[2] * sr];
  const U = [U0[0] * cr + L0[0] * sr, U0[1] * cr + L0[1] * sr, U0[2] * cr + L0[2] * sr];
  const O = [st.x, st.y, st.z];
  return {
    O, L, F, U, s,
    w: (l) => [O[0] + l[0] * L[0] + l[1] * F[0] + l[2] * U[0], O[1] + l[0] * L[1] + l[1] * F[1] + l[2] * U[1], O[2] + l[0] * L[2] + l[1] * F[2] + l[2] * U[2]],
    d: (l) => [l[0] * L[0] + l[1] * F[0] + l[2] * U[0], l[0] * L[1] + l[1] * F[1] + l[2] * U[1], l[0] * L[2] + l[1] * F[2] + l[2] * U[2]],
    loc: (p) => { const d = sub(p, O); return [dot(d, L), dot(d, F), dot(d, U)]; },
  };
}

// Planar chain: links with coupled bends (b, c1·b, …). Returns 2-D joints for bend b.
function chain2D(lens, coup, b) {
  const pts = [[0, 0]];
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < lens.length; i++) {
    if (i > 0) a += b * coup[i - 1];
    x += lens[i] * Math.cos(a); y += lens[i] * Math.sin(a);
    pts.push([x, y]);
  }
  return pts;
}
const CHAIN_CACHE = new Map();
function reachTable(lens, coup, maxB) {
  const key = lens.join(',') + '|' + coup.join(',');
  if (CHAIN_CACHE.has(key)) return CHAIN_CACHE.get(key);
  const N = 256, tab = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { const p = chain2D(lens, coup, (i / N) * maxB); const e = p[p.length - 1]; tab[i] = Math.hypot(e[0], e[1]); }
  const out = { N, tab, maxB };
  CHAIN_CACHE.set(key, out);
  return out;
}
// Solve the chain from base B to target T; `palmar` is the side it curls toward.
// Returns world joints and the bend; `reached` false when the target is out of reach.
function solveChain(B, T, palmar, lens, coup, maxB = 1.75) {
  const tab = reachTable(lens, coup, maxB);
  const v = sub(T, B);
  const D = len3(v);
  let b;
  if (D >= tab.tab[0]) b = 0;
  else if (D <= tab.tab[tab.N]) b = maxB;
  else {
    let lo = 0, hi = tab.N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab.tab[m] > D) lo = m; else hi = m; }
    const f = (tab.tab[lo] - D) / (tab.tab[lo] - tab.tab[hi]);
    b = ((lo + f) / tab.N) * maxB;
  }
  const p2 = chain2D(lens, coup, b);
  const e = p2[p2.length - 1];
  const rot = -Math.atan2(e[1], e[0]);
  const u = D > 1e-6 ? [v[0] / D, v[1] / D, v[2] / D] : [0, 1, 0];
  let p = sub(palmar, add([0, 0, 0], u, dot(palmar, u)));
  p = norm(p);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const pts = p2.map(([x, y]) => { const xr = x * cr - y * sr, yr = x * sr + y * cr; return add(add(B, u, xr), p, yr); });
  return { pts, bend: b, reached: Math.abs(len3(sub(pts[pts.length - 1], T))) < 2, u, palmar: p };
}

// Natural (relaxed, curved) fingertip offsets in hand-local coordinates.
const NAT_TIP = {};
for (let f = 2; f <= 5; f++) {
  const [l1, l2, l3] = ANAT.len[f];
  const a1 = NAT.mcp, a2 = a1 + NAT.pip, a3 = a2 + NAT.pip * NAT.dip;
  const fwd = l1 * Math.cos(a1) + l2 * Math.cos(a2) + l3 * Math.cos(a3);
  const down = l1 * Math.sin(a1) + l2 * Math.sin(a2) + l3 * Math.sin(a3);
  const a = ANAT.abd[f], m = ANAT.mcp[f];
  NAT_TIP[f] = { local: [m[0] + Math.sin(a) * fwd, m[1] + Math.cos(a) * fwd, m[2] - down], D: Math.hypot(fwd, down), e: Math.atan2(down, fwd) };
}
NAT_TIP[1] = { local: ANAT.thumbRest };
const LTOT = {}; for (let f = 1; f <= 5; f++) LTOT[f] = ANAT.len[f][0] + ANAT.len[f][1] + ANAT.len[f][2];
// Reach R(b) and chain-end angle E(b) as functions of the PIP bend b, to read joint angles off a target.
const TAB = {};
for (let f = 2; f <= 5; f++) {
  const N = 200, R = new Float64Array(N + 1), E = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { const p = chain2D(ANAT.len[f], [1, NAT.dip], (i / N) * 1.75); const e = p[p.length - 1]; R[i] = Math.hypot(e[0], e[1]); E[i] = Math.atan2(e[1], e[0]); }
  TAB[f] = { N, R, E };
}
function fingerAngles(f, D, elev) {
  const { N, R, E } = TAB[f];
  if (D >= R[0]) return { b: 0, th: elev - E[0], over: D - R[0] };
  if (D <= R[N]) return { b: 1.75, th: elev - E[N], over: 0 };
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m] > D) lo = m; else hi = m; }
  const q = (R[lo] - D) / (R[lo] - R[hi]);
  return { b: ((lo + q) / N) * 1.75, th: elev - (E[lo] + (E[hi] - E[lo]) * q), over: 0 };
}

// Black-key occupancy along the keyboard (1 mm resolution) for keeping idle fingers above the keys.
const BLACK_AT = new Uint8Array(Math.ceil(KEYBOARD_W) + 2);
for (let m = LOW; m <= HIGH; m++) if (isBlack(m)) { const x = keyX(m); for (let i = Math.floor(x - BLACK_TOP_W / 2 - 1); i <= Math.ceil(x + BLACK_TOP_W / 2 + 1); i++) if (i >= 0 && i < BLACK_AT.length) BLACK_AT[i] = 1; }
const surfaceZ = (x, y) => (y > BLACK_FRONT_Y - 2 && BLACK_AT[Math.round(clamp(x, 0, BLACK_AT.length - 1))] ? BLACK_H : 0);

// Depth of a key (0..~1.05) at time t from its note list.
export function keyDepthFrom(list, t) {
  let d = 0;
  for (let i = lowerBound(list, t - 3, (n) => n.keyUp); i < list.length; i++) {
    const n = list[i];
    if (n.tContact > t) break;
    let v;
    if (t < n.on) v = Math.pow((t - n.tContact) / (n.on - n.tContact), 1.7);
    else if (t <= n.keyUp) {
      const s = t - n.on;
      v = 1 + 0.07 * n.vel * Math.exp(-s / 0.016) * Math.sin(Math.min(Math.PI, (s / 0.03) * Math.PI));
    } else {
      const u = (t - n.keyUp) / 0.07;
      v = u < 1 ? (1 - u) ** 2.2 : u < 1.6 ? 0.035 * Math.sin(((u - 1) / 0.6) * Math.PI) * (1.6 - u) : 0;
    }
    if (v > d) d = v;
  }
  return d;
}
export const dipAt = (depth, y) => (depth * KEY_DIP * (PIVOT_Y - y)) / PIVOT_Y;

// Monotone cubic (Fritsch–Carlson) interpolation sampled on a uniform grid.
function pchipSample(ts, vs, t0, dt, n) {
  const m = ts.length, out = new Float64Array(n);
  if (m === 1) { out.fill(vs[0]); return out; }
  const h = [], d = [], k = new Float64Array(m);
  for (let i = 0; i < m - 1; i++) { h.push(Math.max(1e-6, ts[i + 1] - ts[i])); d.push((vs[i + 1] - vs[i]) / h[i]); }
  k[0] = d[0]; k[m - 1] = d[m - 2];
  for (let i = 1; i < m - 1; i++) {
    if (d[i - 1] * d[i] <= 0) k[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; k[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    if (t <= ts[0]) { out[i] = vs[0]; continue; }
    if (t >= ts[m - 1]) { out[i] = vs[m - 1]; continue; }
    while (ts[j + 1] < t) j++;
    const u = (t - ts[j]) / h[j], u2 = u * u, u3 = u2 * u;
    out[i] = (2 * u3 - 3 * u2 + 1) * vs[j] + (u3 - 2 * u2 + u) * h[j] * k[j] + (-2 * u3 + 3 * u2) * vs[j + 1] + (u3 - u2) * h[j] * k[j + 1];
  }
  return out;
}
function gaussSmooth(arr, sigma) {
  const r = Math.ceil(sigma * 3), w = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, ws = 0;
    for (let j = -r; j <= r; j++) { const k = Math.min(arr.length - 1, Math.max(0, i + j)); s += arr[k] * w[j + r]; ws += w[j + r]; }
    out[i] = s / ws;
  }
  return out;
}

export function makeHandAnimator(perf, hand, keyNotes) {
  const plan = perf.hands[hand];
  const poses = plan.poses, groups = plan.groups;
  const s = hand === 'R' ? 1 : -1;
  const elbow = [BODY_X + s * 190, -330, 40];
  const yawPrior = (x) => 0.5 * Math.atan2(x - elbow[0], 300) + s * 0.03;
  const fingers = {};
  for (let f = 1; f <= 5; f++) fingers[f] = plan.fingers[f].slice().sort((a, b) => a.tContact - b.tContact);
  const myNotes = perf.notes.filter((n) => n.hand === hand);
  const firstT = poses[0].t;
  const lastUp = Math.max(...myNotes.map((n) => n.keyUp));
  const tipR = (f) => ANAT.rad[f][1];

  // ---------- 1. comfortable hand pose for every chord ----------
  function itemTarget(fr, it) {
    if (it.fixedY !== null) return [it.x, it.fixedY, it.z];
    const nat = fr.w(NAT_TIP[it.f].local);
    return [it.x, clamp(lerp(nat[1], it.yPref, 0.6), it.lo, it.hi), it.z];
  }
  function poseCost(st, items, prev, zNat) {
    const fr = handFrame(st, s);
    let c = 0;
    for (const it of items) {
      const T = itemTarget(fr, it);
      if (it.fixedY === null) c += ((T[1] - it.yPref) / 24) ** 2;
      const lt = fr.loc(T);
      if (it.f === 1) {
        const r = NAT_TIP[1].local;
        c += ((lt[0] - r[0]) / 22) ** 2 + ((lt[1] - r[1]) / 26) ** 2 + ((lt[2] - r[2]) / 14) ** 2;
        const D = len3(sub(lt, ANAT.cmc));
        if (D > 0.95 * LTOT[1]) c += 40 * ((D - 0.95 * LTOT[1]) / 4) ** 2;
        if (D < 0.55 * LTOT[1]) c += 10 * ((0.55 * LTOT[1] - D) / 6) ** 2;
      } else {
        const v = sub(lt, ANAT.mcp[it.f]);
        const a = Math.atan2(v[0], v[1]) - ANAT.abd[it.f];
        const h = Math.hypot(v[0], v[1]);
        const ang = fingerAngles(it.f, Math.hypot(h, v[2]), Math.atan2(-v[2], h));
        c += (a / 0.2) ** 2 + ((ang.th - NAT.mcp) / 0.2) ** 2 + ((ang.b - NAT.pip) / 0.3) ** 2;
        if (ang.over > 0) c += 50 * (ang.over / 4) ** 2;
        if (ang.th < -0.1) c += 30 * ((-0.1 - ang.th) / 0.06) ** 2;
        if (ang.th > 0.95) c += 30 * ((ang.th - 0.95) / 0.08) ** 2;
        if (Math.abs(a) > 0.42) c += 30 * ((Math.abs(a) - 0.42) / 0.05) ** 2;
      }
    }
    c += ((st.yaw - yawPrior(st.x)) / 0.16) ** 2 + ((st.z - zNat) / 9) ** 2;
    if (prev) c += ((st.x - prev.x) / 90) ** 2 + ((st.y - prev.y) / 45) ** 2;
    return c;
  }
  const keys = [];
  let prev = null;
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i], g = groups[i];
    const items = g.shape.map((sh) => {
      const n = sh.n;
      const [lo, hi] = contactRange(n.midi);
      const fresh = g.notes.includes(n);
      return { f: sh.f, n, x: keyX(n.midi), z: keyTopZ(n.midi) + tipR(sh.f) * 0.9, lo, hi, fixedY: fresh ? null : n.cy ?? null };
    });
    const anyBlack = items.some((it) => isBlack(it.n.midi));
    // where on the key each finger likes to land: white keys in front, black keys mid-length
    for (const it of items) it.yPref = isBlack(it.n.midi) ? 88 : it.f === 1 ? (anyBlack ? 46 : 24) : anyBlack ? 62 : 40;
    const zNat = Z_NAT + (anyBlack ? 5 : 0);
    let st = { x: 0, y: 0, z: zNat, yaw: 0, pitch: 0.06 + (anyBlack ? 0.03 : 0), roll: 0 };
    st.x = items.reduce((a, it) => a + it.x - s * NAT_TIP[it.f].local[0], 0) / items.length;
    st.y = items.reduce((a, it) => a + it.yPref - NAT_TIP[it.f].local[1], 0) / items.length;
    st.yaw = yawPrior(st.x);
    if (prev && Math.abs(prev.x - st.x) < 60) { st.x = (st.x + prev.x) / 2; st.y = (st.y + prev.y) / 2; }
    const steps = { x: 16, y: 16, z: 8, yaw: 0.12 };
    let best = poseCost(st, items, prev, zNat);
    for (let level = 0; level < 7; level++) {
      let improved = true, guard = 0;
      while (improved && guard++ < 12) {
        improved = false;
        for (const k of ['x', 'y', 'z', 'yaw']) for (const sg of [1, -1]) {
          const cand = { ...st, [k]: st[k] + sg * steps[k] };
          const c = poseCost(cand, items, prev, zNat);
          if (c < best) { best = c; st = cand; improved = true; }
        }
      }
      for (const k in steps) steps[k] /= 2;
    }
    // forearm rotation toward the fingers that strike
    const fr = handFrame(st, s);
    let latAcc = 0, wAcc = 0;
    for (const it of items) {
      const T = itemTarget(fr, it);
      if (g.notes.includes(it.n)) { it.n.cy = T[1]; latAcc += fr.loc(T)[0] * it.n.vel; wAcc += it.n.vel; }
    }
    st.roll = wAcc ? clamp(latAcc / wAcc / 45, -1, 1) * 0.13 : 0;
    st.t = p.t; st.leave = p.leave; st.loud = p.loud; st.cost = best;
    keys.push(st);
    prev = st;
  }

  // ---------- 2. continuous trajectory ----------
  const DT = 1 / 240, T0 = Math.max(0, firstT - 3), T1 = Math.min(perf.duration, lastUp + 4);
  const NS = Math.ceil((T1 - T0) / DT) + 2;
  const knots = { t: [], x: [], y: [], z: [], yaw: [], pitch: [], roll: [] };
  const pushK = (t, k) => { if (knots.t.length && t <= knots.t[knots.t.length - 1] + 1e-4) return; knots.t.push(t); for (const c of ['x', 'y', 'z', 'yaw', 'pitch', 'roll']) knots[c].push(k[c]); };
  keys.forEach((k, i) => {
    pushK(k.t, k);
    const nx = keys[i + 1];
    if (nx) {
      const d = Math.hypot(nx.x - k.x, nx.y - k.y);
      const tMove = 0.1 + 0.2 * Math.pow(d / 250, 0.6);
      const hold = Math.max(k.t + 0.05, Math.min(k.leave, nx.t - tMove));
      if (hold < nx.t - 0.06) pushK(hold, k);
    }
  });
  const ch = {};
  for (const c of ['x', 'y', 'z', 'yaw', 'pitch', 'roll']) ch[c] = pchipSample(knots.t, knots[c], T0, DT, NS);
  // leap arcs and arm weight
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    const dx = Math.hypot(b.x - a.x, b.y - a.y);
    if (dx < 35) continue;
    const t0 = Math.max(a.t + 0.05, Math.min(a.leave, b.t - 0.12)), t1 = b.t;
    const A = Math.min(52, 0.2 * dx);
    for (let j = Math.max(0, Math.floor((t0 - T0) / DT)); j < NS && T0 + j * DT < t1; j++) {
      const u = (T0 + j * DT - t0) / (t1 - t0);
      if (u > 0) ch.z[j] += A * Math.sin(Math.PI * u) ** 1.3;
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const gap = i > 0 ? k.t - keys[i - 1].t : 2;
    let A = 0;
    if (k.loud > 0.5) A = 30 * ((k.loud - 0.5) / 0.5) ** 1.2;
    else if (gap > 0.6) A = 7;                                   // a breath between slow chords
    A *= clamp((gap - 0.12) / 0.35);
    if (A < 0.5) continue;
    const pre = Math.min(0.42, gap * 0.8);
    for (let j = Math.max(0, Math.floor((k.t - pre - T0) / DT)); j < NS; j++) {
      const t = T0 + j * DT;
      if (t > k.t + 0.6) break;
      let v;
      if (t < k.t) { const u = (t - (k.t - pre)) / pre; v = u < 0.72 ? A * minjerk(u / 0.72) : A * (1 - easeInQuad((u - 0.72) / 0.28)); }
      else { const a = (t - k.t) / 0.1; v = -0.32 * A * a * Math.exp(1 - a); }
      ch.z[j] += v;
    }
  }
  for (const c of ['x', 'y', 'z', 'yaw', 'pitch', 'roll']) ch[c] = gaussSmooth(ch[c], 4);
  const sampleCh = (c, t) => {
    const x = clamp((t - T0) / DT, 0, NS - 1.001), i = Math.floor(x), f = x - i;
    return ch[c][i] + (ch[c][i + 1] - ch[c][i]) * f;
  };

  function pose(t) {
    const st = {};
    for (const c of ['x', 'y', 'z', 'yaw', 'pitch', 'roll']) st[c] = sampleCh(c, t);
    st.z += 1.1 * noise1(t * 0.8, s > 0 ? 3 : 9);
    st.x += 0.7 * noise1(t * 0.55, s > 0 ? 13 : 19);
    // rise into place before the first bell; lift away after the last chord
    const enter = minjerk((t - (firstT - 1.75)) / 1.6);
    if (enter < 1) { st.y -= 150 * (1 - enter); st.z += 120 * (1 - enter); st.pitch -= 0.25 * (1 - enter); }
    const leave = minjerk((t - (lastUp + 0.1)) / 1.8);
    if (leave > 0) { st.y -= 110 * leave; st.z += 90 * leave; st.pitch -= 0.2 * leave; }
    st.alpha = smoothstep((t - (firstT - 1.8)) / 0.7) * (1 - smoothstep((t - (lastUp + 0.6)) / 1.4));
    return st;
  }

  // ---------- 3. fingers ----------
  // Long fingers are driven in joint space (abduction a, knuckle flexion th, PIP bend b): a finger
  // lifts by rotating at the knuckle, so its tip travels on a natural arc and never locks straight.
  function contactPoint(n, t, f) {
    const depth = keyDepthFrom(keyNotes[n.midi], t);
    return [keyX(n.midi), n.cy, keyTopZ(n.midi) - dipAt(depth, n.cy) + tipR(f) * 0.9];
  }
  function fkLocal(f, a, th, b) {
    const m = ANAT.mcp[f], L = ANAT.len[f];
    const sa = Math.sin(a), ca = Math.cos(a);
    const al = [th, th + b, th + b + NAT.dip * b];
    const pts = [m.slice()];
    let x = m[0], y = m[1], z = m[2];
    for (let i = 0; i < 3; i++) { const h = L[i] * Math.cos(al[i]); x += sa * h; y += ca * h; z -= L[i] * Math.sin(al[i]); pts.push([x, y, z]); }
    return pts;
  }
  function ikLocal(f, Tl) {
    const v = sub(Tl, ANAT.mcp[f]);
    const a0 = ANAT.abd[f], a = clamp(Math.atan2(v[0], v[1]), a0 - 0.45, a0 + 0.45);
    const h = Math.hypot(v[0], v[1]);
    const ang = fingerAngles(f, Math.hypot(h, v[2]), Math.atan2(-v[2], h));
    return { a, th: clamp(ang.th, -0.4, 1.5), b: ang.b };
  }
  function idleAngles(fr, f, t) {
    const a = ANAT.abd[f] * 0.65;
    let th = NAT.mcp + 0.02 + 0.035 * noise1(t * 0.9 + f * 5.1, s > 0 ? 1 : 2);
    const b = NAT.pip + 0.12;
    for (let k = 0; k < 8; k++) {              // stay clear of the keys underneath
      const tip = fr.w(fkLocal(f, a, th, b)[3]);
      const floor = surfaceZ(tip[0], tip[1]) + tipR(f) + 4;
      if (tip[2] >= floor) break;
      th -= Math.min(0.1, (floor - tip[2]) / 75 + 0.015);
    }
    return { a, th, b };
  }
  const keyTopTarget = (n, f) => [keyX(n.midi), n.cy, keyTopZ(n.midi) + tipR(f) * 0.9];
  function fingerState(fr, f, t) {
    const list = fingers[f];
    const i = lowerBound(list, t, (n) => n.tContact) - 1;
    const prevN = i >= 0 ? list[i] : null, next = list[i + 1] || null;
    if (prevN && t <= prevN.keyUp) return { ...ikLocal(f, fr.loc(contactPoint(prevN, t, f))), contact: true, note: prevN };
    let A = idleAngles(fr, f, t);
    if (prevN) {
      const u = (t - prevN.keyUp) / 0.16;
      if (u < 1) {                              // lift off the key and relax
        const C = ikLocal(f, fr.loc(contactPoint(prevN, t, f)));
        const k = smoothstep(u);
        A = { a: lerp(C.a, A.a, k), th: lerp(C.th, A.th, k) - 0.09 * Math.sin(Math.PI * Math.min(1, u * 1.25)), b: lerp(C.b, A.b, k) };
      }
    }
    if (next) {
      let strike = 0.03 + 0.05 * (1 - next.vel), lift = 0.08 + 0.1 * (1 - next.vel);
      const avail = next.tContact - (prevN ? prevN.keyUp : -1e9);
      if (avail < strike + lift + 0.02) { const k = Math.max(0.08, (avail - 0.01) / (strike + lift)); strike *= k; lift *= k; }
      const tS = next.tContact - strike, tL = tS - lift;
      if (t >= tL) {
        const C = ikLocal(f, fr.loc(keyTopTarget(next, f)));
        const h = (5 + 20 * Math.pow(next.vel, 1.3)) * clamp(avail / 0.25, 0.35, 1);
        const up = clamp(h / (0.8 * LTOT[f]), 0.05, 0.42);
        if (t >= tS) return { a: C.a, th: lerp(C.th - up, C.th, easeInQuad((t - tS) / strike)), b: C.b, striking: true };
        const k = minjerk((t - tL) / lift);
        return { a: lerp(A.a, C.a, k), th: lerp(A.th, C.th - up, k), b: lerp(A.b, C.b, k), preparing: true };
      }
    }
    return A;
  }
  function thumbTarget(fr, t) {
    const f = 1, list = fingers[1];
    const i = lowerBound(list, t, (n) => n.tContact) - 1;
    const prevN = i >= 0 ? list[i] : null, next = list[i + 1] || null;
    if (prevN && t <= prevN.keyUp) return { p: contactPoint(prevN, t, f), contact: true, note: prevN };
    const free = fr.w(NAT_TIP[1].local);
    free[2] = Math.max(free[2] + 6, surfaceZ(free[0], free[1]) + tipR(1) + 4);
    let p = free;
    if (prevN) {
      const u = (t - prevN.keyUp) / 0.16;
      if (u < 1) { const c = contactPoint(prevN, t, f); c[2] += 6 * Math.sin(Math.PI * 0.5 * Math.min(1, u * 1.6)); const k = smoothstep(u); p = [lerp(c[0], free[0], k), lerp(c[1], free[1], k), lerp(c[2], free[2], k)]; }
    }
    if (next) {
      let strike = 0.035 + 0.05 * (1 - next.vel), lift = 0.08 + 0.1 * (1 - next.vel);
      const avail = next.tContact - (prevN ? prevN.keyUp : -1e9);
      if (avail < strike + lift + 0.02) { const k = Math.max(0.08, (avail - 0.01) / (strike + lift)); strike *= k; lift *= k; }
      const tS = next.tContact - strike, tL = tS - lift;
      if (t >= tL) {
        const c = keyTopTarget(next, f);
        const Lp = [c[0] - s * 3, c[1] - 2, c[2] + (4 + 16 * Math.pow(next.vel, 1.3)) * clamp(avail / 0.25, 0.35, 1)];
        if (t >= tS) { const k = easeInQuad((t - tS) / strike); return { p: [lerp(Lp[0], c[0], k), lerp(Lp[1], c[1], k), lerp(Lp[2], c[2], k)], striking: true }; }
        const k = minjerk((t - tL) / lift);
        return { p: [lerp(p[0], Lp[0], k), lerp(p[1], Lp[1], k), lerp(p[2], Lp[2], k)], preparing: true };
      }
    }
    return { p };
  }

  function skeleton(t) {
    const H = pose(t);
    const fr = handFrame(H, s);
    const out = { hand, s, H, fr, alpha: H.alpha, fingers: {} };
    const st = {};
    for (let f = 2; f <= 5; f++) st[f] = fingerState(fr, f, t);
    for (let f = 2; f <= 5; f++) {          // shared tendons: neighbours follow a moving finger a little
      if (st[f].contact || st[f].striking || st[f].preparing) continue;
      for (const g of [f - 1, f + 1]) if (g >= 2 && g <= 5 && (st[g].preparing || st[g].striking)) st[f].th -= g === 4 || f === 4 ? 0.06 : 0.03;
    }
    for (let f = 2; f <= 5; f++) {
      const A = st[f];
      const pts = fkLocal(f, A.a, A.th, A.b).map((p) => fr.w(p));
      const lat = norm(cross(fr.d([Math.sin(A.a), Math.cos(A.a), 0]), fr.U));
      const reached = !A.contact || len3(sub(pts[3], contactPoint(A.note, t, f))) < 3;
      out.fingers[f] = { pts, lat, flex: [A.th, A.b, A.b * NAT.dip], contact: !!A.contact, note: A.note, reached };
    }
    const raw = { 1: thumbTarget(fr, t) };
    // thumb: metacarpal turns toward the target (opposition), then a two-link MCP/IP chain
    {
      const C = fr.w(ANAT.cmc);
      const T = raw[1].p;
      const m0 = fr.d(ANAT.thumbMeta);
      const toT = norm(sub(T, C));
      const reach = len3(sub(T, C)) / LTOT[1];
      const k = 0.42 + 0.3 * clamp((reach - 0.75) / 0.2);
      const m = norm(add(m0, sub(toT, m0), k));
      const P1 = add(C, m, ANAT.len[1][0]);
      const nail = norm(fr.d(ANAT.thumbNail));
      const sol = solveChain(P1, T, sub([0, 0, 0], nail), [ANAT.len[1][1], ANAT.len[1][2]], [0.85], 1.6);
      const pts = [C, ...sol.pts];
      const lat = norm(cross(sol.u, nail));
      out.fingers[1] = { pts, lat, nail, flex: [0, sol.bend, sol.bend * 0.85], contact: !!raw[1].contact, note: raw[1].note, reached: sol.reached };
    }
    out.wrist = fr.w(ANAT.wrist);
    out.elbowDir = norm(sub(elbow, out.wrist));
    return out;
  }

  return { pose, skeleton, firstT, lastUp, keys };
}
