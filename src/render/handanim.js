// Hand & finger kinematics: hand pose over time, fingertip trajectories, inverse kinematics.
import { keyX, keyTopZ, KEY_DIP, PIVOT_Y } from '../keyboard.js';
import { FINGER_OFF, TIP_FWD, contactRange } from '../hands.js';
import { clamp, lerp, lerp3, minjerk, smoothstep, easeInQuad, noise1, lowerBound } from '../util.js';

const BASE_Z = 50;               // knuckle height above the white keys while playing
const BODY_X = 611;              // pianist sits at the middle of the keyboard
const spreadFor = (span) => 1 + 0.28 * clamp((span - 85) / 110);
const dropFor = (span) => 16 * clamp((span - 95) / 90);
export const SEG = {             // phalanx lengths (mm) and joint radii [MCP, PIP, DIP, tip]
  1: { len: [50, 33, 29], rad: [13.5, 10.8, 9.8, 8.6] },
  2: { len: [45, 27, 21], rad: [9.6, 8.6, 7.7, 6.8] },
  3: { len: [49, 30, 22], rad: [10.0, 8.9, 8.0, 7.0] },
  4: { len: [46, 28, 21], rad: [9.4, 8.4, 7.5, 6.7] },
  5: { len: [37, 22, 19], rad: [8.2, 7.3, 6.6, 6.0] },
};
// Hand-local anchors (lateral → pinky side, forward → into the keyboard, up), right hand.
export const LOCAL = {
  mcp: { 2: [-22, -2, -1], 3: [0, 0, 0], 4: [19, -3, -2], 5: [36, -12, -6] },
  cmc: [-22, -60, -17],
  wrist: [5, -86, -6],
};

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
      v = 1 + 0.07 * n.vel * Math.exp(-s / 0.016) * Math.sin(Math.min(Math.PI, s / 0.03 * Math.PI));
    } else {
      const u = (t - n.keyUp) / 0.07;
      v = u < 1 ? (1 - u) ** 2.2 : u < 1.6 ? 0.035 * Math.sin(((u - 1) / 0.6) * Math.PI) * (1.6 - u) : 0;
    }
    if (v > d) d = v;
  }
  return d;
}

export const dipAt = (depth, y) => depth * KEY_DIP * (PIVOT_Y - y) / PIVOT_Y;

export function makeHandAnimator(perf, hand, keyNotes) {
  const plan = perf.hands[hand];
  const poses = plan.poses;
  const s = hand === 'R' ? 1 : -1;
  const fingers = {};
  for (let f = 1; f <= 5; f++) fingers[f] = plan.fingers[f].slice().sort((a, b) => a.tContact - b.tContact);
  const firstT = poses[0].t;
  const lastUp = Math.max(...perf.notes.filter((n) => n.hand === hand).map((n) => n.keyUp));
  const elbowBaseX = BODY_X + s * 200;

  function rawPose(t) {
    let i = lowerBound(poses, t, (p) => p.t) - 1;
    if (i < 0) i = 0;
    const p = poses[i], q = poses[i + 1];
    let x = p.x, y = p.y, z = BASE_Z - dropFor(p.span), spread = spreadFor(p.span);
    if (q && t >= p.leave && t > p.t) {
      const u = clamp((t - p.leave) / Math.max(0.02, q.t - p.leave));
      const k = minjerk(u);
      x = lerp(p.x, q.x, k);
      y = lerp(p.y, q.y, k);
      z = BASE_Z - lerp(dropFor(p.span), dropFor(q.span), k);
      spread = lerp(spread, spreadFor(q.span), k);
      const dist = p.dist || 0;
      if (dist > 30) z += Math.min(62, 0.17 * dist) * Math.sin(Math.PI * u) ** 1.2;
    }
    // Arm weight: lift and throw the hand into loud chords, then a small rebound.
    for (const g of [q, p]) {
      if (!g || g.loud < 0.55) continue;
      const A = 34 * ((g.loud - 0.55) / 0.45) ** 1.3;
      const dt = g.t - t;
      if (dt > 0 && dt < 0.4) z += A * Math.sin(Math.PI * clamp(1 - dt / 0.4) * 0.999) * (dt < 0.13 ? dt / 0.13 : 1);
      const after = t - g.on;
      if (after > 0 && after < 0.5) z += 0.25 * A * (after / 0.09) * Math.exp(1 - after / 0.09);
    }
    // Breathing / living hand.
    z += 1.2 * noise1(t * 0.7, hand === 'R' ? 3 : 9);
    x += 0.8 * noise1(t * 0.5, hand === 'R' ? 13 : 19);
    return { x, y, z, spread };
  }

  function pose(t) {
    let P = rawPose(t);
    // Entrance from below the frame, and the final lift.
    const enter = smoothstep((t - (firstT - 2.2)) / 1.9);
    if (enter < 1) {
      const k = minjerk(enter);
      P = { ...P, x: lerp(P.x + s * 60, P.x, k), y: lerp(P.y - 260, P.y, k), z: lerp(P.z + 140, P.z, k) };
    }
    const leave = minjerk((t - (lastUp + 0.15)) / 2.4);
    if (leave > 0) P = { ...P, x: P.x + s * 30 * leave, y: P.y - 120 * leave, z: P.z + 95 * leave };
    return { ...P, yaw: yawFor(P.x), enter, leave, s };
  }

  function yawFor(x) { return s * -0.07 + 0.55 * Math.atan2(x - elbowBaseX, 360); }
  // Convert hand-local [lat, fwd, up] to world; knuckles fan out for wide spans.
  function toWorld(H, l, spreadable = false) {
    const cy = Math.cos(H.yaw), sy = Math.sin(H.yaw);
    const lat = l[0] * H.s * (spreadable ? H.spread || 1 : 1), fwd = l[1], up = l[2];
    const roll = H.roll || 0;
    const lat2 = lat * Math.cos(roll), up2 = up + lat * Math.sin(roll);
    return [H.x + lat2 * cy + fwd * sy, H.y - lat2 * sy + fwd * cy, H.z + up2];
  }

  function restTip(H, f) {
    const off = FINGER_OFF[hand][f];
    // relaxed, slightly gathered fingers; they open toward the target as the hand arrives
    const p = toWorld(H, [off * H.s * (f === 1 ? 0.78 : 0.86), TIP_FWD[f] * 0.88 - 4, 0]);
    const n = noise1(H.t * 0.9 + f * 7.3, hand === 'R' ? 1 : 2);
    return [p[0], p[1], 16 + 2.5 * n + (H.z - BASE_Z) * 0.9];
  }

  function contactPoint(n, t) {
    const y = n.cy;
    const depth = keyDepthFrom(keyNotes[n.midi], t);
    return [keyX(n.midi), y, keyTopZ(n.midi) - dipAt(depth, y) + SEG[n.finger].rad[3] * 0.75];
  }

  function tip(H, f, t) {
    const list = fingers[f];
    const i = lowerBound(list, t, (n) => n.tContact) - 1;
    const prev = i >= 0 ? list[i] : null;
    const next = list[i + 1] || null;
    if (prev && t <= prev.keyUp) return { p: contactPoint(prev, t), contact: true, note: prev };
    let free = restTip(H, f);
    if (prev) {
      const rel = smoothstep((t - prev.keyUp) / 0.13);
      if (rel < 1) {
        const c = contactPoint(prev, t);
        c[2] += 4 * rel;
        free = lerp3(c, free, rel);
      }
    }
    if (next) {
      let strike = 0.028 + 0.06 * (1 - next.vel), lift = 0.075 + 0.09 * (1 - next.vel);
      const avail = next.tContact - (prev ? prev.keyUp : -Infinity);
      if (avail < strike + lift + 0.02) { const k = Math.max(0.05, (avail - 0.01) / (strike + lift)); strike *= k; lift *= k; }
      const tStrike = next.tContact - strike, tLift = tStrike - lift;
      if (t >= tLift) {
        const c = [keyX(next.midi), next.cy, keyTopZ(next.midi) + SEG[f].rad[3] * 0.75];
        const L = [c[0], c[1] - 5, c[2] + 6 + 36 * Math.pow(next.vel, 1.15)];
        if (t >= tStrike) return { p: lerp3(L, c, easeInQuad((t - tStrike) / strike)), contact: false, striking: true };
        return { p: lerp3(free, L, minjerk((t - tLift) / lift)), contact: false };
      }
    }
    return { p: free, contact: false };
  }

  // Inverse kinematics of a 3-phalanx finger with DIP ≈ 0.72·PIP coupling.
  function solveFinger(base, target, len, kCouple, fwdDir) {
    const dx = target[0] - base[0], dy = target[1] - base[1], dz = target[2] - base[2];
    let hu = Math.hypot(dx, dy);
    let hx = dx / (hu || 1), hy = dy / (hu || 1);
    if (hu < 1e-3) { hx = fwdDir[0]; hy = fwdDir[1]; }
    const D = Math.hypot(hu, dz);
    const vlen = (a2) => {
      const a3 = a2 * (1 + kCouple);
      const u = len[0] + len[1] * Math.cos(a2) + len[2] * Math.cos(a3);
      const w = len[1] * Math.sin(a2) + len[2] * Math.sin(a3);
      return [u, w];
    };
    const maxA = 1.75;
    let a2;
    const full = len[0] + len[1] + len[2];
    if (D >= full * 0.999) a2 = 0.04;
    else {
      let lo = 0, hi = maxA;
      for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; const [u, w] = vlen(m); if (Math.hypot(u, w) > D) lo = m; else hi = m; }
      a2 = (lo + hi) / 2;
    }
    const [vu, vw] = vlen(a2);
    const a1 = Math.atan2(-dz, hu) - Math.atan2(vw, vu); // downward angle of the proximal phalanx
    const th = [a1, a1 + a2, a1 + a2 + a2 * kCouple];
    const pts = [base];
    let cu = 0, cw = 0;
    for (let k = 0; k < 3; k++) {
      cu += len[k] * Math.cos(th[k]);
      cw -= len[k] * Math.sin(th[k]);
      pts.push([base[0] + hx * cu, base[1] + hy * cu, base[2] + cw]);
    }
    return { pts, flex: a2 };
  }

  function skeleton(t) {
    const H = pose(t);
    H.t = t;
    const raw = {};
    let rollAcc = 0, rollW = 0;
    for (let f = 1; f <= 5; f++) {
      raw[f] = tip(H, f, t);
      if (raw[f].contact) { rollAcc += FINGER_OFF[hand][f] * H.s; rollW += 1; }
    }
    H.roll = rollW ? clamp((rollAcc / rollW) / 40, -1, 1) * -0.12 : 0;
    // Enslaving: neighbours of a striking finger follow it a little.
    for (let f = 1; f <= 5; f++) {
      if (raw[f].contact || raw[f].striking) continue;
      for (const g of [f - 1, f + 1]) {
        if (!raw[g] || !(raw[g].striking || raw[g].contact)) continue;
        raw[f].p = [raw[f].p[0], raw[f].p[1], raw[f].p[2] - 2.5];
      }
    }
    const fwdDir = [Math.sin(H.yaw), Math.cos(H.yaw)];
    const out = { hand, H, fingers: {}, wrist: toWorld(H, LOCAL.wrist) };
    for (let f = 2; f <= 5; f++) {
      const base = toWorld(H, LOCAL.mcp[f], true);
      const sol = solveFinger(base, raw[f].p, SEG[f].len, 0.72, fwdDir);
      out.fingers[f] = { pts: sol.pts, rad: SEG[f].rad, contact: raw[f].contact, flex: sol.flex, note: raw[f].note };
    }
    const cmc = toWorld(H, LOCAL.cmc, true);
    const solT = solveFinger(cmc, raw[1].p, SEG[1].len, 0.55, fwdDir);
    out.fingers[1] = { pts: solT.pts, rad: SEG[1].rad, contact: raw[1].contact, flex: solT.flex, note: raw[1].note };
    out.cmc = cmc;
    out.local = (l) => toWorld(H, l);
    const elbow = [elbowBaseX + (H.x - elbowBaseX) * 0.3, H.y - 360, H.z - 10];
    out.elbow = elbow;
    return out;
  }

  // Slide each planned pose along the keys until every finger of the chord can reach.
  const planH = (p, y) => ({ x: p.x, y, z: BASE_Z - dropFor(p.span), yaw: yawFor(p.x), s, spread: spreadFor(p.span), roll: 0 });
  const reachDeficit = (Hp, f, midi) => {
    const L = SEG[f].len[0] + SEG[f].len[1] + SEG[f].len[2];
    const m = toWorld(Hp, f === 1 ? LOCAL.cmc : LOCAL.mcp[f], true);
    const [lo, hi] = contactRange(midi);
    const yBest = Math.min(hi, Math.max(lo, m[1] + 0.45 * L));
    const d = Math.hypot(keyX(midi) - m[0], yBest - m[1], m[2] - keyTopZ(midi) - SEG[f].rad[3] * 0.75);
    return Math.max(0, d - 0.9 * L) + Math.max(0, 0.45 * L - d) * 0.5;
  };
  for (const p of poses) {
    if (p.y0 === undefined) p.y0 = p.y;
    let best = p.y0, bestC = Infinity;
    for (let y = p.y0 - 16; y <= p.y0 + 90; y += 3) {
      const Hp = planH(p, y);
      let c = 0.0004 * (y - p.y0) ** 2;
      for (const { f, midi } of p.shape) c += reachDeficit(Hp, f, midi) ** 2;
      if (c < bestC) { bestC = c; best = y; }
    }
    p.y = best;
  }

  // Choose where on its key each finger lands so it is reachable from the planned hand pose.
  for (let f = 1; f <= 5; f++) {
    const L = SEG[f].len[0] + SEG[f].len[1] + SEG[f].len[2];
    for (const n of fingers[f]) {
      const p = poses[n.poseIdx] || poses[0];
      const Hp = planH(p, p.y);
      const m = toWorld(Hp, f === 1 ? LOCAL.cmc : LOCAL.mcp[f], true);
      const dx = keyX(n.midi) - m[0], dz = m[2] - (keyTopZ(n.midi) + SEG[f].rad[3] * 0.75);
      const [lo, hi] = contactRange(n.midi);
      const base = dx * dx + dz * dz;
      const maxR = (0.93 * L) ** 2 - base, minR = (0.5 * L) ** 2 - base;
      let y = n.contactY;
      if (maxR <= 0) y = Math.min(hi, Math.max(lo, m[1] + 4));
      else {
        const yMin = m[1] + Math.sqrt(Math.max(0, minR)), yMax = m[1] + Math.sqrt(maxR);
        y = Math.min(yMax, Math.max(yMin, y));
        y = Math.min(hi, Math.max(lo, y));
      }
      n.cy = y;
    }
  }

  return { pose, skeleton, firstT, lastUp };
}
