// Engraving-style hand rendering: ink silhouette, skin modelling, hatching, nails,
// starched cuffs with gold links and tail-coat sleeves; plus soft cast shadows.
import { clipSegment } from './camera.js';
import { LOCAL } from './handanim.js';

const INK = '#2e1d12';
const SKIN = { light: '#f7e3c8', mid: '#e8c39d', shade: '#b8865f', deep: '#8a5a3a' };
const LIGHT2D = [-0.62, -0.78]; // light comes from the upper left of the frame

function capsule(ctx, A, B, ra, rb) {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L = Math.hypot(dx, dy);
  if (L < 0.5) { ctx.moveTo(A[0] + Math.max(ra, rb), A[1]); ctx.arc(A[0], A[1], Math.max(ra, rb), 0, Math.PI * 2); return; }
  const ang = Math.atan2(dy, dx);
  const d = Math.asin(Math.max(-0.95, Math.min(0.95, (ra - rb) / L)));
  ctx.moveTo(A[0] + ra * Math.cos(ang + Math.PI / 2 + d), A[1] + ra * Math.sin(ang + Math.PI / 2 + d));
  ctx.arc(A[0], A[1], ra, ang + Math.PI / 2 + d, ang + (3 * Math.PI) / 2 - d);
  ctx.arc(B[0], B[1], rb, ang - Math.PI / 2 - d, ang + Math.PI / 2 + d);
  ctx.closePath();
}

function smoothClosed(ctx, pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]);
  }
  ctx.closePath();
}

function segGradient(ctx, A, B, r, cols, sideBias = 0) {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  if (nx * LIGHT2D[0] + ny * LIGHT2D[1] < 0) { nx = -nx; ny = -ny; } // n points toward the light
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
  const g = ctx.createLinearGradient(mx - nx * r, my - ny * r, mx + nx * r, my + ny * r);
  g.addColorStop(0, cols.deep);
  g.addColorStop(0.22 + sideBias, cols.shade);
  g.addColorStop(0.62, cols.mid);
  g.addColorStop(0.84, cols.light);
  g.addColorStop(1, cols.mid);
  return { g, nx, ny, L };
}

function hatchSegment(ctx, A, B, r, nx, ny, width, alpha) {
  // engraved contour lines on the shadow side (opposite to the light normal)
  ctx.strokeStyle = `rgba(46,29,18,${alpha})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [off, a0, a1] of [[0.42, 0.12, 0.88], [0.6, 0.18, 0.82], [0.76, 0.26, 0.74]]) {
    const ox = -nx * r * off, oy = -ny * r * off;
    ctx.moveTo(A[0] + (B[0] - A[0]) * a0 + ox, A[1] + (B[1] - A[1]) * a0 + oy);
    ctx.lineTo(A[0] + (B[0] - A[0]) * a1 + ox, A[1] + (B[1] - A[1]) * a1 + oy);
  }
  ctx.stroke();
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function drawFinger(ctx, cam, F, isThumb) {
  const P = F.pts.map((p) => cam.project(p));
  const R = F.rad.map((r, i) => r * P[i][3]);
  const ow = Math.max(1.1, 0.9 * P[3][3]);
  // ink silhouette
  ctx.fillStyle = INK;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) capsule(ctx, P[k], P[k + 1], R[k] + ow, R[k + 1] + ow);
  ctx.fill();
  // skin, distal → proximal so the knuckles overlap naturally
  for (let k = 2; k >= 0; k--) {
    const { g, nx, ny } = segGradient(ctx, P[k], P[k + 1], (R[k] + R[k + 1]) / 2, SKIN, isThumb ? 0.06 : 0);
    ctx.fillStyle = g;
    ctx.beginPath(); capsule(ctx, P[k], P[k + 1], R[k], R[k + 1]); ctx.fill();
    hatchSegment(ctx, P[k], P[k + 1], (R[k] + R[k + 1]) / 2, nx, ny, Math.max(0.5, 0.33 * P[k][3]), 0.3);
  }
  // knuckle creases
  ctx.strokeStyle = 'rgba(90,52,30,0.55)';
  ctx.lineWidth = Math.max(0.5, 0.45 * P[1][3]);
  ctx.beginPath();
  for (const j of [1, 2]) {
    const A = P[j - 1], B = P[j + 1];
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L, r = R[j] * 0.55;
    for (const o of [-0.18, 0.18]) {
      const cx = P[j][0] + (dx / L) * r * o * 2, cy = P[j][1] + (dy / L) * r * o * 2;
      ctx.moveTo(cx - nx * r, cy - ny * r);
      ctx.quadraticCurveTo(cx + (dx / L) * r * 0.25, cy + (dy / L) * r * 0.25, cx + nx * r, cy + ny * r);
    }
  }
  ctx.stroke();
  // fingernail, modelled in 3-D on the dorsal side of the distal phalanx
  const D = F.pts[2], T = F.pts[3];
  const d = norm(sub(T, D));
  const lat = norm(cross([0, 0, 1], d).map((v, i) => (i === 2 ? 0 : v)));
  let up = norm(cross(d, lat));
  if (up[2] < 0 && Math.abs(d[2]) < 0.6) up = up.map((v) => -v);
  const segL = Math.hypot(...sub(T, D));
  const rT = F.rad[3] * (isThumb ? 1.0 : 0.95);
  const c = add(add(D, d, segL * 0.66), up, rT * 0.78);
  const hl = segL * 0.36, hw = rT * 0.62;
  const q = [add(c, d, hl), add(c, lat, hw), add(c, d, -hl), add(c, lat, -hw)].map((p) => cam.project(p));
  const facing = -(up[0] * cam.fwd[0] + up[1] * cam.fwd[1] + up[2] * cam.fwd[2]);
  if (facing > 0.05) {
    ctx.beginPath();
    ctx.moveTo((q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2);
    for (let i = 1; i <= 4; i++) {
      const a = q[i % 4], b = q[(i + 1) % 4];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
    const ng = ctx.createLinearGradient(q[2][0], q[2][1], q[0][0], q[0][1]);
    ng.addColorStop(0, 'rgba(226,170,150,0.95)');
    ng.addColorStop(0.7, 'rgba(244,214,196,0.95)');
    ng.addColorStop(1, 'rgba(252,240,226,0.98)');
    ctx.fillStyle = ng; ctx.fill();
    ctx.strokeStyle = 'rgba(70,40,25,0.75)';
    ctx.lineWidth = Math.max(0.5, 0.4 * P[3][3]);
    ctx.stroke();
  }
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// A true cylinder (not a capsule): silhouette = hull of its two projected end rings.
function cylinderGeom(cam, a, b, ra, rb) {
  const near = cam.near;
  cam.near = 140;
  const seg = clipSegment(cam, a, b);
  cam.near = near;
  if (!seg) return null;
  [a, b] = seg;
  const d = norm(sub(b, a));
  let u = cross(d, [0, 0, 1]);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-3) u = [1, 0, 0];
  u = norm(u);
  const v = cross(d, u);
  const ring = (c, r) => { const out = []; for (let k = 0; k < 24; k++) { const th = (k / 24) * Math.PI * 2; out.push(add(add(c, u, r * Math.cos(th)), v, r * Math.sin(th))); } return out; };
  const RA = ring(a, ra), RB = ring(b, rb);
  const PA = RA.map((p) => cam.project(p)), PB = RB.map((p) => cam.project(p));
  return { a, b, d, u, v, ra, rb, hull: convexHull([...PA, ...PB]), A: cam.project(a), B: cam.project(b) };
}

function ringFront(ctx, cam, g, k, r, from = 0, to = 1) {
  // the half of a ring (at fraction k along the cylinder) that faces the camera
  const c = add(g.a, sub(g.b, g.a), k);
  let started = false;
  for (let i = 0; i <= 40; i++) {
    const th = (i / 40) * Math.PI * 2;
    const dir = add(g.u.map((x) => x * Math.cos(th)), g.v, Math.sin(th));
    const p = add(c, dir, r);
    const toCam = sub(cam.pos, p);
    const vis = dir[0] * toCam[0] + dir[1] * toCam[1] + dir[2] * toCam[2] > 0 && i / 40 >= from && i / 40 <= to;
    const q = cam.project(p);
    if (vis) { if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]); }
    else started = false;
  }
}

function drawLimbCylinder(ctx, cam, a, b, ra, rb, cols, ink = INK) {
  const g = cylinderGeom(cam, a, b, ra, rb);
  if (!g) return null;
  const { A, B, hull } = g;
  ctx.beginPath();
  hull.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.6, 1.6 * A[3]); ctx.stroke();
  const R = Math.max(ra * A[3], rb * B[3]);
  const { g: grad, nx, ny } = segGradient(ctx, A, B, R, cols);
  ctx.fillStyle = grad; ctx.fill();
  return { ...g, RA: ra * A[3], RB: rb * B[3], nx, ny };
}

const CUFF = { light: '#fbf6ea', mid: '#eee5d0', shade: '#c9bb9b', deep: '#8f7f62' };
const CLOTH = { light: '#4a4240', mid: '#26201f', shade: '#161211', deep: '#0b0908' };

function drawArm(ctx, cam, sk) {
  const w = sk.wrist;
  const dir = norm(sub(sk.elbow, w));
  const far = add(w, dir, 900);
  // Sleeve of the tail coat, then the starched shirt cuff.
  const sl = drawLimbCylinder(ctx, cam, add(w, dir, 70), far, 41, 52, CLOTH);
  if (sl) {
    ctx.strokeStyle = 'rgba(130,118,110,0.35)';
    ctx.lineWidth = Math.max(0.6, sl.A[3] * 1.1);
    for (const k of [0.03, 0.07, 0.12]) { ctx.beginPath(); ringFront(ctx, cam, sl, k, sl.ra * (1 + k) * 1.01, 0.05, 0.45); ctx.stroke(); }
  }
  const cf = drawLimbCylinder(ctx, cam, add(w, dir, 22), add(w, dir, 64), 33, 35, CUFF);
  if (cf) {
    ctx.strokeStyle = 'rgba(70,52,34,0.8)'; ctx.lineWidth = Math.max(0.8, 0.9 * cf.A[3]);
    ctx.beginPath(); ringFront(ctx, cam, cf, 0.0, 33.2); ctx.stroke();
    ctx.setLineDash([2.5, 3]);
    ctx.strokeStyle = 'rgba(120,100,70,0.55)'; ctx.lineWidth = Math.max(0.6, 0.5 * cf.A[3]);
    ctx.beginPath(); ringFront(ctx, cam, cf, 0.16, 33.4); ctx.stroke();
    ctx.beginPath(); ringFront(ctx, cam, cf, 0.84, 35.2); ctx.stroke();
    ctx.setLineDash([]);
    // gold cufflink on the outer side
    const H = sk.H;
    const outer = norm([Math.cos(H.yaw) * H.s, -Math.sin(H.yaw) * H.s, 0.55]);
    const lp = cam.project(add(add(w, dir, 44), outer, 34));
    const r = 5.5 * lp[3];
    const lg = ctx.createRadialGradient(lp[0] - r * 0.35, lp[1] - r * 0.35, r * 0.1, lp[0], lp[1], r);
    lg.addColorStop(0, '#fff2c0'); lg.addColorStop(0.45, '#d9a443'); lg.addColorStop(1, '#6e4a14');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.ellipse(lp[0], lp[1], r, r * 0.75, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.6, 0.5 * lp[3]); ctx.stroke();
  }
}

function palmOutline(sk) {
  const L = [
    [-24, -92, -8], [-37, -62, -14], [-33, -22, -6], [-27, 2, 1], [-11, 8, 4], [6, 8, 4],
    [21, 4, 2], [36, -6, -1], [44, -24, -7], [43, -58, -10], [31, -94, -8], [4, -100, -6],
  ];
  return L.map((l) => sk.local(l));
}

function drawPalm(ctx, cam, sk) {
  const pts = palmOutline(sk).map((p) => cam.project(p));
  const sc = cam.project(sk.local([2, -40, 8]));
  const ow = Math.max(1.2, sc[3]);
  // wrist (skin) leading into the cuff
  drawLimbCylinder(ctx, cam, sk.local([4, -74, -8]), sk.local([4, -126, -10]), 27, 28.5, SKIN);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath(); smoothClosed(ctx, pts);
  ctx.strokeStyle = INK; ctx.lineWidth = ow * 2; ctx.stroke();
  const g = ctx.createRadialGradient(sc[0] - 18 * sc[3], sc[1] - 20 * sc[3], 4 * sc[3], sc[0], sc[1], 70 * sc[3]);
  g.addColorStop(0, SKIN.light); g.addColorStop(0.45, SKIN.mid); g.addColorStop(0.85, SKIN.shade); g.addColorStop(1, SKIN.deep);
  ctx.fillStyle = g; ctx.fill();
  ctx.clip();
  // tendons and knuckles
  const wristC = cam.project(sk.local([3, -84, 4]));
  for (const f of [2, 3, 4, 5]) {
    const k = cam.project(sk.local(LOCAL.mcp[f].map((v, i) => (i === 2 ? v + 8 : i === 1 ? v - 2 : v))));
    const tg = ctx.createLinearGradient(wristC[0], wristC[1], k[0], k[1]);
    tg.addColorStop(0, 'rgba(255,240,220,0)'); tg.addColorStop(0.7, 'rgba(255,242,224,0.45)'); tg.addColorStop(1, 'rgba(255,244,228,0.7)');
    ctx.strokeStyle = tg; ctx.lineWidth = 3.2 * k[3];
    ctx.beginPath(); ctx.moveTo(wristC[0], wristC[1]); ctx.lineTo(k[0], k[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,75,45,0.22)'; ctx.lineWidth = 0.8 * k[3];
    ctx.beginPath(); ctx.moveTo(wristC[0] + 2.2 * k[3], wristC[1]); ctx.lineTo(k[0] + 2.2 * k[3], k[1]); ctx.stroke();
    const kg = ctx.createRadialGradient(k[0] - 1.5 * k[3], k[1] - 2 * k[3], 0, k[0], k[1], 9 * k[3]);
    kg.addColorStop(0, 'rgba(255,246,232,0.8)'); kg.addColorStop(1, 'rgba(255,246,232,0)');
    ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(k[0], k[1], 9 * k[3], 0, Math.PI * 2); ctx.fill();
  }
  // a vein and engraved hatching along the shadowed (outer) edge
  const v = [sk.local([10, -78, 6]), sk.local([14, -50, 8]), sk.local([8, -24, 7])].map((p) => cam.project(p));
  ctx.strokeStyle = 'rgba(110,120,140,0.22)'; ctx.lineWidth = 1.6 * sc[3];
  ctx.beginPath(); ctx.moveTo(v[0][0], v[0][1]); ctx.quadraticCurveTo(v[1][0], v[1][1], v[2][0], v[2][1]); ctx.stroke();
  ctx.strokeStyle = 'rgba(46,29,18,0.3)'; ctx.lineWidth = Math.max(0.5, 0.35 * sc[3]);
  ctx.beginPath();
  const side = sk.H.s > 0 ? 1 : -1;
  for (let i = 0; i < 9; i++) {
    const fw = -86 + i * 10;
    const a = cam.project(sk.local([side > 0 ? 28 : -26, fw, 4])), b = cam.project(sk.local([side > 0 ? 46 : -40, fw + 4, -6]));
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawHand(ctx, cam, sk) {
  if (sk.H.leave >= 0.999) return;
  drawFinger(ctx, cam, sk.fingers[1], true);
  const order = [2, 3, 4, 5].sort((a, b) => cam.depth(sk.fingers[b].pts[3]) - cam.depth(sk.fingers[a].pts[3]));
  for (const f of order) drawFinger(ctx, cam, sk.fingers[f], false);
  drawPalm(ctx, cam, sk);
  drawArm(ctx, cam, sk);
}

// Shadows cast on the keys (z = 0 plane) along the light direction.
export const LIGHT3D = norm([0.42, 0.62, -1]);
const toPlane = (p) => { const k = p[2] / -LIGHT3D[2]; return [p[0] + LIGHT3D[0] * k, p[1] + LIGHT3D[1] * k, 0]; };

export function drawHandShadow(ctx, cam, sk, scale) {
  if (sk.H.leave >= 0.999) return;
  ctx.beginPath();
  for (let f = 1; f <= 5; f++) {
    const F = sk.fingers[f];
    const P = F.pts.map((p) => cam.project(toPlane(p)));
    for (let k = 0; k < 3; k++) capsule(ctx, [P[k][0] * scale, P[k][1] * scale], [P[k + 1][0] * scale, P[k + 1][1] * scale], F.rad[k] * P[k][3] * scale, F.rad[k + 1] * P[k + 1][3] * scale);
  }
  const pts = palmOutline(sk).map((p) => { const q = cam.project(toPlane(p)); return [q[0] * scale, q[1] * scale]; });
  smoothClosed(ctx, pts);
  ctx.fill();
}
