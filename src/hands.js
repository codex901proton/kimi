// Hand assignment, fingering (beam search over physically feasible hand shapes),
// key-down/up timing and hand pose keyframes.
import { keyX, isBlack, keyTopZ, W, WHITE_L, BLACK_FRONT_Y } from './keyboard.js';
import { clamp } from './util.js';

// How far ahead of the middle knuckle each fingertip naturally lands (mm), and where on a
// key each finger prefers to play: the thumb near the front edge, long fingers deeper in.
export const TIP_FWD = [0, 16, 54, 60, 55, 42];
const REACH = [0, 22, 18, 18, 16, 12];   // how much further a finger can extend when flattened
const PREF_Y = { white: [0, 14, 46, 52, 48, 38], black: [0, 70, 82, 86, 83, 78] };
export function contactRange(midi) {
  return isBlack(midi) ? [BLACK_FRONT_Y + 8, WHITE_L - 12] : [6, WHITE_L - 14];
}
// Natural fingertip offsets (mm) from the middle finger, per hand.
export const FINGER_OFF = { R: [0, -50, -22, 0, 21, 40], L: [0, 50, 22, 0, -21, -40] };
// [comfortable, maximum] distance between fingertips a<b (mm). Max 1–5 ≈ a tenth: a big Romantic hand.
const SPAN = {
  '1,2': [72, 135], '1,3': [100, 165], '1,4': [128, 176], '1,5': [168, 192],
  '2,3': [38, 82], '2,4': [62, 118], '2,5': [96, 146], '3,4': [34, 70], '3,5': [66, 120], '4,5': [38, 84],
};
const MIN_GAP = 9;
const BEAM = 48;

// Key travel time from first finger contact to hammer strike (faster when louder).
export const keyTravel = (vel) => 0.016 + 0.058 * (1 - vel) ** 1.4;

function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
}

// pts: [{f, x, black}] → cost or Infinity if the hand cannot make the shape.
function shapeCost(pts, hand) {
  const s = hand === 'R' ? 1 : -1;
  const a = pts.slice().sort((p, q) => p.f - q.f);
  let cost = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const d = s * (a[j].x - a[i].x);
      const [comfort, hard] = SPAN[`${a[i].f},${a[j].f}`];
      if (d > hard) return Infinity;
      if (j === i + 1) {
        if (d < MIN_GAP) return Infinity;
        if (d > comfort) cost += ((d - comfort) / W) ** 2 * 1.3;
        const natural = s * (FINGER_OFF[hand][a[j].f] - FINGER_OFF[hand][a[i].f]);
        if (d < natural * 0.45) cost += ((natural * 0.45 - d) / W) ** 2 * 0.6;
      }
    }
  }
  const allBlack = a.every((p) => p.black);
  for (const p of a) {
    if (p.f === 1 && p.black && !allBlack) cost += a.length > 1 ? 0.9 : 0.45;
    if (p.f === 5 && p.black && a.length === 1) cost += 0.3;
  }
  return cost;
}

const handCenter = (pts, hand) => pts.reduce((s, p) => s + p.x - FINGER_OFF[hand][p.f], 0) / pts.length;

function feasibleAlone(notes, hand) {
  const pts = notes.map((n) => ({ x: keyX(n.midi), black: isBlack(n.midi) }));
  if (pts.length > 5) return false;
  const order = pts.map((p, i) => i).sort((i, j) => pts[i].x - pts[j].x);
  for (const c of combos([1, 2, 3, 4, 5], pts.length)) {
    const fs = hand === 'R' ? c : c.slice().reverse();
    const shape = order.map((idx, k) => ({ f: fs[k], x: pts[idx].x, black: pts[idx].black }));
    if (shapeCost(shape, hand) < Infinity) return true;
  }
  return false;
}

// Split chords no single hand can reach: lower part slightly before the beat, then leap
// (how pianists handle such spans, relying on the pedal).
function splitGroup(notes, hand) {
  if (feasibleAlone(notes, hand)) return [notes];
  const s = notes.slice().sort((a, b) => a.midi - b.midi);
  let best = 1, gap = -1;
  for (let i = 1; i < s.length; i++) { const g = s[i].midi - s[i - 1].midi; if (g > gap) { gap = g; best = i; } }
  return [...splitGroup(s.slice(0, best), hand), ...splitGroup(s.slice(best), hand)];
}

export function buildGroups(notes, hand) {
  const mine = notes.filter((n) => n.hand === hand);
  const byBeat = new Map();
  for (const n of mine) { if (!byBeat.has(n.beat)) byBeat.set(n.beat, []); byBeat.get(n.beat).push(n); }
  const groups = [];
  let splits = 0;
  for (const [beat, ns] of [...byBeat.entries()].sort((a, b) => a[0] - b[0])) {
    const parts = splitGroup(ns, hand);
    if (parts.length > 1) {
      splits++;
      const t0 = Math.min(...ns.map((n) => n.on));
      // total time spent leaping, centred on the beat
      const centers = parts.map((p) => p.reduce((a, n) => a + keyX(n.midi), 0) / p.length);
      let total = 0;
      for (let i = 1; i < parts.length; i++) total += 0.07 + Math.abs(centers[i] - centers[i - 1]) / 2600;
      let t = t0 - total * 0.42;
      parts.forEach((p, i) => {
        if (i > 0) t += 0.07 + Math.abs(centers[i] - centers[i - 1]) / 2600;
        for (const n of p) { n.on = t + (n.on - t0) * 0.3; n.split = true; }
      });
    }
    for (const p of parts) groups.push({ beat, notes: p, t: Math.min(...p.map((n) => n.on)) });
  }
  groups.sort((a, b) => a.t - b.t);
  return { groups, splits };
}

// Beam search over finger assignments. Returns per-note finger and early-release decisions.
export function planFingering(groups, hand) {
  let beam = [{ cost: 0, held: [], center: null, t: -10, lastSingle: null, lastByFinger: {}, parent: null, assign: null, dropped: [] }];
  for (const g of groups) {
    const t = g.t;
    const newPts = g.notes.map((n) => ({ n, x: keyX(n.midi), black: isBlack(n.midi) })).sort((a, b) => a.x - b.x);
    const k = newPts.length;
    const next = [];
    for (const st of beam) {
      const still = st.held.filter((h) => h.n.notatedOff > t + 0.03);
      const hn = still.length;
      for (let mask = 0; mask < 1 << hn; mask++) {
        const kept = [], dropped = [];
        let dropCost = 0;
        for (let i = 0; i < hn; i++) {
          if (mask & (1 << i)) kept.push(still[i]);
          else {
            dropped.push(still[i]);
            const r = still[i].n.role;
            const w = r === 'melody' || r === 'theme' ? 2.6 : 1;
            dropCost += w * (0.3 + 0.9 * clamp((still[i].n.notatedOff - t) / 0.9));
          }
        }
        if (kept.some((h) => newPts.some((p) => p.n.midi === h.n.midi))) continue; // re-strike needs release
        const used = new Set(kept.map((h) => h.f));
        const avail = [1, 2, 3, 4, 5].filter((f) => !used.has(f));
        if (avail.length < k) continue;
        for (const c of combos(avail, k)) {
          const fs = hand === 'R' ? c : c.slice().reverse();
          const assigned = newPts.map((p, i) => ({ f: fs[i], x: p.x, black: p.black, n: p.n }));
          const shape = [...kept, ...assigned];
          let cost = shapeCost(shape, hand);
          if (cost === Infinity) continue;
          cost += dropCost;
          const center = handCenter(shape, hand);
          if (st.center !== null) {
            const dc = Math.abs(center - st.center), dt = Math.max(0.01, t - st.t);
            cost += 0.12 * (dc / W) + 3 * Math.max(0, dc - 1700 * dt) / W;
          }
          for (const a of assigned) {
            const prev = st.lastByFinger[a.f];
            if (prev && prev.midi !== a.n.midi && prev.notatedOff > t - 0.08 && t - prev.on < 0.8) cost += 1.0;
            if (prev && prev.midi === a.n.midi && t - prev.on < 0.25) cost -= 0.1;
          }
          if (k === 1 && st.lastSingle && t - st.lastSingle.t < 0.9) {
            const s = hand === 'R' ? 1 : -1;
            const dx = s * (assigned[0].x - st.lastSingle.x), df = assigned[0].f - st.lastSingle.f;
            if (dx * df < 0) cost += assigned[0].f === 1 || st.lastSingle.f === 1 ? 0.8 : 5;
          }
          const lastByFinger = { ...st.lastByFinger };
          for (const a of assigned) lastByFinger[a.f] = a.n;
          next.push({
            cost: st.cost + cost, held: shape, center, t,
            lastSingle: k === 1 ? { f: assigned[0].f, x: assigned[0].x, t } : null,
            lastByFinger, parent: st, assign: assigned, dropped,
          });
        }
      }
    }
    if (!next.length) throw new Error(`no fingering for ${hand} group at ${t.toFixed(2)}s: ${g.notes.map((n) => n.midi)}`);
    next.sort((a, b) => a.cost - b.cost);
    const seen = new Set();
    beam = [];
    for (const st of next) {
      const sig = st.held.map((h) => `${h.f}:${h.n.midi}`).sort().join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      beam.push(st);
      if (beam.length >= BEAM) break;
    }
  }
  // Backtrack.
  const path = [];
  for (let st = beam[0]; st && st.assign; st = st.parent) path.push(st);
  path.reverse();
  path.forEach((st, i) => {
    groups[i].center = st.center;
    groups[i].shape = st.held;
    for (const a of st.assign) a.n.finger = a.f;
    for (const d of st.dropped) d.n.droppedAt = groups[i].t;
  });
  return beam[0].cost;
}

// Key-down/up timing per note, finger contacts and hand pose keyframes.
export function planMotion(groups, hand) {
  const fingers = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const poses = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const blackMode = g.shape.some((p) => p.black);
    const tContact = Math.min(...g.notes.map((n) => n.on - keyTravel(n.vel)));
    // hand depth: the compromise that lets every active finger land where it likes
    const ys = g.shape.map((p) => (p.black ? PREF_Y.black : PREF_Y.white)[p.f] + (blackMode && !p.black ? 10 : 0) - TIP_FWD[p.f]);
    let handY = ys.reduce((a, b) => a + b, 0) / ys.length;
    let yLo = -Infinity, yHi = Infinity;
    for (const p of g.shape) {
      const [lo, hi] = contactRange(p.n.midi);
      yLo = Math.max(yLo, lo - TIP_FWD[p.f] - REACH[p.f]);
      yHi = Math.min(yHi, hi - TIP_FWD[p.f] + 26);
    }
    handY = yLo <= yHi ? Math.min(yHi, Math.max(yLo, handY)) : (yLo + yHi) / 2;
    const span = Math.abs(Math.max(...g.shape.map((p) => p.x)) - Math.min(...g.shape.map((p) => p.x)));
    const loud = Math.max(...g.notes.map((n) => n.vel));
    poses.push({ t: tContact, on: g.t, x: g.center, y: handY, span, loud, blackMode, n: g.notes.length, shape: g.shape.map((p) => ({ f: p.f, midi: p.n.midi })) });
    for (const n of g.notes) n.poseIdx = gi;
    for (const p of g.shape) {
      if (!g.notes.includes(p.n)) continue;
      const [lo, hi] = contactRange(p.n.midi);
      p.n.contactY = Math.min(hi, Math.max(lo, handY + TIP_FWD[p.f]));
      p.n.blackMode = blackMode;
    }
  }
  // Movement windows: when the hand leaves pose i for pose i+1.
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i], q = poses[i + 1];
    if (!q) { p.leave = Infinity; continue; }
    const dist = Math.hypot(q.x - p.x, q.y - p.y);
    const tMove = dist < 4 ? 0.08 : 0.08 + 0.21 * Math.pow(dist / 300, 0.6);
    p.dist = dist;
    p.leave = Math.max(p.on + 0.04, q.t - tMove);
  }
  const all = groups.flatMap((g) => g.notes);
  groups.forEach((g, gi) => {
    for (const n of g.notes) {
      let up = n.notatedOff - 0.012;
      // The hand releases what it cannot take along when it departs for the next position.
      for (let j = gi; j < groups.length; j++) {
        const p = poses[j];
        if (!p || p.leave >= up) break;
        const next = groups[j + 1];
        if (next && next.shape.some((s) => s.n === n)) continue;
        up = p.dist > 12 ? Math.min(up, p.leave + 0.015) : Math.min(up, (next ? next.t - keyTravel(n.vel) : up) - 0.02);
        break;
      }
      n.keyUp = Math.max(n.on + 0.09, up);
      n.tContact = n.on - keyTravel(n.vel);
    }
  });
  // Same finger or same key re-used: the key must come up before the next contact.
  const byKey = new Map();
  for (const n of all) {
    fingers[n.finger].push(n);
    if (!byKey.has(n.midi)) byKey.set(n.midi, []);
    byKey.get(n.midi).push(n);
  }
  const fixSeq = (seq) => {
    seq.sort((a, b) => a.on - b.on);
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i], b = seq[i + 1];
      const limit = b.tContact - Math.min(0.045, 0.3 * (b.tContact - a.on));
      if (a.keyUp > limit) a.keyUp = Math.max(a.on + 0.03, limit);
    }
  };
  Object.values(fingers).forEach(fixSeq);
  for (const seq of byKey.values()) fixSeq(seq);
  return { fingers, poses };
}

export function planHands(notes) {
  const out = {};
  for (const hand of ['R', 'L']) {
    const { groups, splits } = buildGroups(notes, hand);
    const cost = planFingering(groups, hand);
    const motion = planMotion(groups, hand);
    out[hand] = { groups, cost, splits, ...motion };
  }
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
  return out;
}

export { keyTopZ };
