// Software-rasterised 3-D hands: procedural anatomical mesh (palm, thenar web, fingers,
// opposable thumb, fading forearm) rebuilt every frame from the skeleton, z-buffered at 2×2
// supersampling and shaded per pixel (wrap-lit skin, nails, knuckle creases, tendons, rim light).
import { createCanvas } from '@napi-rs/canvas';
import { ANAT } from './handanim.js';

const SS = 2;
const MAXW = 900, MAXH = 1300;
const HS = 1.05;
const TAU = Math.PI * 2;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a, b, t) => a + (b - a) * t;
function n3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addk = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pw(x, e) { return x === 0 ? 0 : Math.sign(x) * Math.pow(Math.abs(x), e); }

const LK = n3([-0.6, 0.12, 0.79]), CK = [1.08, 0.96, 0.82];
const LF = n3([0.75, -0.25, 0.45]), CF = [0.15, 0.17, 0.22];
const LR = n3([0.12, 0.92, 0.3]), CR = [1.0, 0.7, 0.4];
const PALM_FRONT = [[-38, -16], [-23.1, 1.5], [0, 3], [20, -1.5], [36.8, -11.5], [48, -26]].map(([x, y]) => [x * HS, y * HS]);
const frontY = (x) => {
  const P = PALM_FRONT;
  if (x <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) if (x <= P[i][0]) return lerp(P[i - 1][1], P[i][1], (x - P[i - 1][0]) / (P[i][0] - P[i - 1][0]));
  return P[P.length - 1][1];
};
const PALM_T = [0, 0.3, 0.6, 0.85, 1];
const PALM = { a: [26, 32, 37, 40, 40.5], cx: [2.5, 3.5, 5, 5.5, 5.5], bt: [17, 15, 12, 9, 8.5], bb: [17, 18, 16, 12.5, 11], cz: [-5.5, -4.5, -3, -2.5, -2.5] };
function palmParam(key, t) {
  const T = PALM_T, A = PALM[key];
  for (let i = 1; i < T.length; i++) if (t <= T[i]) return HS * lerp(A[i - 1], A[i], smooth((t - T[i - 1]) / (T[i] - T[i - 1])));
  return HS * A[A.length - 1];
}
const TENDON_W = [0, 0, -9 * HS, -2 * HS, 5 * HS, 11 * HS];

export class HandRenderer {
  constructor() {
    const n = MAXW * SS * MAXH * SS;
    this.invz = new Float32Array(n); this.tri = new Int32Array(n); this.b1 = new Float32Array(n); this.b2 = new Float32Array(n);
    const MV = 9000, MT = 18000;
    this.P = new Float32Array(MV * 3); this.N = new Float32Array(MV * 3); this.C = new Float32Array(MV * 3);
    this.SX = new Float32Array(MV); this.SY = new Float32Array(MV); this.SZ = new Float32Array(MV);
    this.U = new Float32Array(MV); this.V = new Float32Array(MV); this.AL = new Float32Array(MV);
    this.T = new Int32Array(MT * 3); this.TP = new Uint8Array(MT);
    this.info = new Float32Array(16 * 12);
    this.canvas = createCanvas(MAXW, MAXH);
    this.c2 = this.canvas.getContext('2d');
    this.pz = new Float32Array(MAXW * MAXH);
    this.pc = new Float32Array(MAXW * MAXH * 4);
    this.pp = new Uint8Array(MAXW * MAXH);
    this.tmp = new Float64Array(9);
  }

  // rows × (cols + 1) vertex grid (last column duplicates the first, so v runs 0…1 without a seam).
  grid(rows, cols, part, fn) {
    const { P, C, U, V, AL, N, T, TP, tmp } = this;
    const base = this.nv, W1 = cols + 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j <= cols; j++) {
      fn(i, j % cols, tmp, j / cols);
      const k = this.nv++;
      P[3 * k] = tmp[0]; P[3 * k + 1] = tmp[1]; P[3 * k + 2] = tmp[2];
      U[k] = tmp[3]; V[k] = j / cols; AL[k] = tmp[5];
      C[3 * k] = tmp[6]; C[3 * k + 1] = tmp[7]; C[3 * k + 2] = tmp[8];
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j <= cols; j++) {
      const k = base + i * W1 + j;
      const ip = base + Math.min(rows - 1, i + 1) * W1 + j, im = base + Math.max(0, i - 1) * W1 + j;
      const jj = j === cols ? 0 : j;
      const jp = base + i * W1 + (jj + 1), jm = base + i * W1 + (jj === 0 ? cols - 1 : jj - 1);
      const ux = P[3 * ip] - P[3 * im], uy = P[3 * ip + 1] - P[3 * im + 1], uz = P[3 * ip + 2] - P[3 * im + 2];
      const vx = P[3 * jp] - P[3 * jm], vy = P[3 * jp + 1] - P[3 * jm + 1], vz = P[3 * jp + 2] - P[3 * jm + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      let l = Math.hypot(nx, ny, nz);
      const rx = P[3 * k] - C[3 * k], ry = P[3 * k + 1] - C[3 * k + 1], rz = P[3 * k + 2] - C[3 * k + 2];
      if (l < 1e-5) {          // pole of a cap: point straight out of the tube end
        const o = base + (i === 0 ? 1 : i - 1) * W1 + j;
        nx = P[3 * k] - P[3 * o]; ny = P[3 * k + 1] - P[3 * o + 1]; nz = P[3 * k + 2] - P[3 * o + 2];
        l = Math.hypot(nx, ny, nz) || 1;
      } else if (nx * rx + ny * ry + nz * rz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      N[3 * k] = nx / l; N[3 * k + 1] = ny / l; N[3 * k + 2] = nz / l;
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
      const a = base + i * W1 + j, b = a + 1, c = a + W1, d = c + 1;
      let t = this.nt++; T[3 * t] = a; T[3 * t + 1] = c; T[3 * t + 2] = b; TP[t] = part;
      t = this.nt++; T[3 * t] = b; T[3 * t + 1] = c; T[3 * t + 2] = d; TP[t] = part;
    }
  }

  // Generalised tube along polyline Q with anatomical radius profile prof(s) → [w, hTop, hBot].
  tube(part, Q, lat0, prof, sList, cols, alphaFn) {
    const segL = [];
    for (let i = 0; i + 1 < Q.length; i++) segL.push(Math.hypot(...sub(Q[i + 1], Q[i])));
    const total = segL.reduce((a, b) => a + b, 0);
    const lastDir = n3(sub(Q[Q.length - 1], Q[Q.length - 2]));
    const at = (s) => {
      if (s >= total) return addk(Q[Q.length - 1], lastDir, s - total);
      let acc = 0;
      for (let i = 0; i < segL.length; i++) {
        if (s <= acc + segL[i]) { const f = (s - acc) / segL[i]; return [lerp(Q[i][0], Q[i + 1][0], f), lerp(Q[i][1], Q[i + 1][1], f), lerp(Q[i][2], Q[i + 1][2], f)]; }
        acc += segL[i];
      }
      return Q[Q.length - 1];
    };
    let cs = sList.map(at);
    for (let it = 0; it < 1; it++) {               // round the joints slightly
      const nc = cs.map((c) => c.slice());
      for (let i = 1; i < cs.length - 1; i++) for (let k = 0; k < 3; k++) nc[i][k] = cs[i][k] + 0.5 * ((cs[i - 1][k] + cs[i + 1][k]) / 2 - cs[i][k]);
      cs = nc;
    }
    const tans = cs.map((c, i) => n3(sub(cs[Math.min(cs.length - 1, i + 1)], cs[Math.max(0, i - 1)])));
    const frames = tans.map((t) => {
      let lat = sub(lat0, addk([0, 0, 0], t, dot(lat0, t)));
      lat = n3(lat);
      return [lat, cross(lat, t)];
    });
    const profs = sList.map(prof);
    this.grid(sList.length, cols, part, (i, j, out, v) => {
      const th = v * TAU;
      const c = cs[i], [lat, dor] = frames[i], [w, ht, hb] = profs[i];
      const cx = pw(Math.cos(th), 0.84), sy = pw(Math.sin(th), 0.84);
      const h = sy >= 0 ? ht : hb;
      out[0] = c[0] + lat[0] * w * cx + dor[0] * h * sy;
      out[1] = c[1] + lat[1] * w * cx + dor[1] * h * sy;
      out[2] = c[2] + lat[2] * w * cx + dor[2] * h * sy;
      out[3] = sList[i]; out[5] = alphaFn ? alphaFn(sList[i]) : 1;
      out[6] = c[0]; out[7] = c[1]; out[8] = c[2];
    });
  }

  buildHand(sk) {
    this.nv = 0; this.nt = 0;
    const fr = sk.fr, info = this.info;
    // ---- palm ----
    const flexAvg = [2, 3, 4, 5].reduce((a, f) => a + sk.fingers[f].flex[0], 0) / 4;
    const kn = [0, 0, ...[2, 3, 4, 5].map((f) => 1.6 + 3.2 * Math.max(0, sk.fingers[f].flex[0]))];
    const yW = -97 * HS;
    this.grid(20, 28, 0, (i, j, out, v) => {
      const t = i / 19, th = v * TAU;
      const a = palmParam('a', t), cxm = palmParam('cx', t), cz = palmParam('cz', t);
      let bt = palmParam('bt', t), bb = palmParam('bb', t);
      if (t > 0.86) { const k = (t - 0.86) / 0.14; const f = Math.sqrt(Math.max(0, 1 - k * k)); bt *= 0.25 + 0.75 * f; bb *= 0.15 + 0.85 * f; }
      const c = pw(Math.cos(th), 0.78), sn = pw(Math.sin(th), 0.78);
      const x = cxm + a * c;
      let z = cz + (sn >= 0 ? bt : bb) * sn;
      if (sn > 0) for (let f = 2; f <= 5; f++) z += kn[f] * Math.exp(-(((x - ANAT.mcp[f][0]) / 7.5) ** 2)) * smooth((t - 0.72) / 0.22) * sn;
      const y = lerp(yW, frontY(x), t);
      const p = fr.w([x, y, z]), cc = fr.w([cxm, lerp(yW, frontY(cxm), t), cz]);
      out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; out[3] = t; out[5] = 1;
      out[6] = cc[0]; out[7] = cc[1]; out[8] = cc[2];
    });
    // palm v holds the local x (for tendons) — overwrite the generic v
    {
      const base = this.nv - 20 * 29;
      for (let i = 0; i < 20; i++) for (let j = 0; j <= 28; j++) {
        const k = base + i * 29 + j, th = (j / 28) * TAU;
        const t = i / 19;
        this.V[k] = palmParam('cx', t) + palmParam('a', t) * pw(Math.cos(th), 0.78);
      }
    }
    info[0] = flexAvg;
    // ---- fingers ----
    for (let f = 2; f <= 5; f++) {
      const F = sk.fingers[f];
      const [l1, l2, l3] = ANAT.len[f], [r0, r1] = ANAT.rad[f];
      const M = F.pts[0];
      const Q0 = addk(addk(M, fr.F, -17 * HS), fr.U, -1.5);
      const sM = 17 * HS, sP = sM + l1, sD = sP + l2, L = sD + l3, rc = r1 * 0.98;
      const flexP = F.flex[1], flexD = F.flex[2];
      const prof = (s) => {
        let w;
        if (s < sM) w = r0 * (0.84 + 0.18 * smooth(s / sM));
        else if (s < sP) w = r0 * (1.02 - 0.09 * (s - sM) / l1);
        else if (s < sD) w = lerp(r0 * 0.93, r1 * 1.05, (s - sP) / l2);
        else if (s < L) { const u = (s - sD) / l3; w = r1 * (1.05 - 0.05 * u + 0.05 * Math.sin(Math.PI * u)); }
        else w = r1 * Math.sqrt(Math.max(0, 1 - ((s - L) / rc) ** 2));
        const knP = Math.exp(-(((s - sP) / (0.36 * r0)) ** 2)), knD = Math.exp(-(((s - sD) / (0.32 * r0)) ** 2));
        const knM = Math.exp(-(((s - sM + 1) / (0.5 * r0)) ** 2));
        w += r0 * (0.05 * knP + 0.035 * knD + 0.04 * knM);
        if (s < 2.5) w *= Math.sqrt(Math.max(0.02, s / 2.5));
        const distal = smooth((s - sD + 2) / 6);
        const ht = w * lerp(0.84, 0.76, distal) + r0 * ((0.07 + 0.1 * Math.min(1, flexP)) * knP + (0.045 + 0.06 * Math.min(1, flexD)) * knD + 0.2 * knM);
        const hb = w * lerp(0.92, 1.02, distal);
        return [w, ht, hb];
      };
      const sList = [0, 1, 2.5];
      for (let s = 5; s < L - 0.5; s += 3.4) sList.push(s);
      for (let k = 0; k <= 6; k++) sList.push(L + rc * Math.sin((k / 6) * Math.PI / 2));
      this.tube(f, [Q0, M, F.pts[1], F.pts[2], F.pts[3]], F.lat, prof, sList, 16);
      const o = f * 12;
      info[o] = sM; info[o + 1] = sP; info[o + 2] = sD; info[o + 3] = L; info[o + 4] = F.flex[1]; info[o + 5] = F.flex[2]; info[o + 6] = r1; info[o + 7] = rc;
    }
    // ---- thumb ----
    {
      const F = sk.fingers[1];
      const [lm, l1, l2] = ANAT.len[1], r1 = ANAT.rad[1][1];
      const sM = lm, sI = lm + l1, L = sI + l2, rc = r1;
      const prof = (s) => {
        let w, ht, hb;
        if (s < sM) { const u = s / sM; w = HS * lerp(14.5, 11.6, u); ht = w * 0.82; hb = w * lerp(1.25, 0.95, u); }
        else if (s < sI) { const u = (s - sM) / l1; w = HS * lerp(11.6, 10.6, u); ht = w * 0.84; hb = w * 0.93; }
        else if (s < L) { const u = (s - sI) / l2; w = r1 * (1.06 + 0.05 * Math.sin(Math.PI * u)); ht = w * 0.78; hb = w * 1.0; }
        else { w = r1 * Math.sqrt(Math.max(0, 1 - ((s - L) / rc) ** 2)); ht = w * 0.78; hb = w; }
        const knM = Math.exp(-(((s - sM) / 4.5) ** 2)), knI = Math.exp(-(((s - sI) / 3.6) ** 2));
        w += 0.5 * knM + 0.4 * knI; ht += 0.9 * knM + 0.5 * knI;
        if (s < 3) { const k = Math.sqrt(Math.max(0.02, s / 3)); w *= k; ht *= k; hb *= k; }
        return [w, ht, hb];
      };
      const sList = [0, 1.2, 3];
      for (let s = 6; s < L - 0.5; s += 3.6) sList.push(s);
      for (let k = 0; k <= 6; k++) sList.push(L + rc * Math.sin((k / 6) * Math.PI / 2));
      this.tube(1, F.pts, F.lat, prof, sList, 18);
      const o = 12;
      info[o] = sM; info[o + 1] = sI; info[o + 2] = sI; info[o + 3] = L; info[o + 4] = F.flex[1]; info[o + 5] = F.flex[2]; info[o + 6] = r1; info[o + 7] = rc;
    }
    // ---- thumb–index web ----
    {
      const C = sk.fingers[1].pts[0], P1 = sk.fingers[1].pts[1];
      const iA = fr.w([-24 * HS, -58 * HS, -5]), iB = fr.w([-25 * HS, -7 * HS, -3]);
      this.grid(9, 12, 6, (i, j, out, v) => {
        const k = i / 8, th = v * TAU;
        const Pi = addk(iA, sub(iB, iA), 0.08 + 0.86 * k), Pt = addk(C, sub(P1, C), 0.18 + 0.72 * k);
        const ctr = [(Pi[0] + Pt[0]) / 2, (Pi[1] + Pt[1]) / 2, (Pi[2] + Pt[2]) / 2];
        const span = sub(Pt, Pi), hw = Math.hypot(...span) / 2;
        const lat = n3(span);
        const dor = n3(addk(fr.U, lat, -dot(fr.U, lat)));
        const close = k < 0.8 ? 1 : Math.sqrt(Math.max(0.01, 1 - ((k - 0.8) / 0.2) ** 2));
        const ht = HS * lerp(11, 5, k) * close, hb = HS * lerp(10, 4, k) * close;
        const c = pw(Math.cos(th), 0.8), sn = pw(Math.sin(th), 0.8);
        let p = addk(addk(ctr, lat, hw * 0.92 * c), dor, (sn >= 0 ? ht : hb) * sn);
        p = addk(p, fr.F, -9 * HS * k * k * (1 - c * c));
        out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; out[3] = k; out[5] = 1;
        out[6] = ctr[0]; out[7] = ctr[1]; out[8] = ctr[2];
      });
    }
    // ---- forearm, dissolving into the dark ----
    {
      const Wp = sk.wrist, E = sk.elbowDir;
      let lat = n3(cross([0, 0, 1], E));
      const Q = [addk(Wp, E, -12), addk(Wp, E, 62)];
      const prof = (s) => { const u = Math.max(0, s - 12) / 62; const w = HS * lerp(27.5, 31, u), h = HS * lerp(17.5, 21, u); return [w, h, h * 1.05]; };
      const sList = []; for (let k = 0; k <= 6; k++) sList.push((74 * k) / 6);
      this.tube(7, Q, lat, prof, sList, 16, (s) => 1 - smooth((s - 26) / 46));
    }
  }

  // Render the hand into ctx (screen px). Returns false when off-screen.
  draw(ctx, cam, sk) {
    if (sk.alpha <= 0.003) return false;
    this.buildHand(sk);
    const { P, SX, SY, SZ, nv, nt, T } = this;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < nv; k++) {
      const p = cam.project([P[3 * k], P[3 * k + 1], P[3 * k + 2]]);
      SX[k] = p[0]; SY[k] = p[1]; SZ[k] = 1 / p[2];
      if (this.AL[k] > 0.01) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(cam.width, Math.ceil(x1) + 2); y1 = Math.min(cam.height, Math.ceil(y1) + 2);
    let bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return false;
    bw = Math.min(bw, MAXW); bh = Math.min(bh, MAXH);
    const W2 = bw * SS, H2 = bh * SS, nS = W2 * H2;
    const { invz, tri, b1, b2 } = this;
    invz.fill(0, 0, nS); tri.fill(-1, 0, nS);
    for (let k = 0; k < nv; k++) { SX[k] = (SX[k] - x0) * SS - 0.5; SY[k] = (SY[k] - y0) * SS - 0.5; }
    const _t0 = performance.now();
    // ---- rasterise visibility ----
    for (let t = 0; t < nt; t++) {
      const i0 = T[3 * t], i1 = T[3 * t + 1], i2 = T[3 * t + 2];
      const ax = SX[i0], ay = SY[i0], bx = SX[i1], by = SY[i1], cx = SX[i2], cy = SY[i2];
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area > -1e-7 && area < 1e-7) continue;
      let mnx = Math.ceil(Math.min(ax, bx, cx)), mxx = Math.floor(Math.max(ax, bx, cx));
      let mny = Math.ceil(Math.min(ay, by, cy)), mxy = Math.floor(Math.max(ay, by, cy));
      if (mnx < 0) mnx = 0; if (mny < 0) mny = 0; if (mxx >= W2) mxx = W2 - 1; if (mxy >= H2) mxy = H2 - 1;
      if (mnx > mxx || mny > mxy) continue;
      const inv = 1 / area, za = SZ[i0], zb = SZ[i1], zc = SZ[i2];
      for (let y = mny; y <= mxy; y++) {
        const row = y * W2;
        for (let x = mnx; x <= mxx; x++) {
          const w0 = ((bx - x) * (cy - y) - (cx - x) * (by - y)) * inv;
          if (w0 < 0) continue;
          const w1 = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) * inv;
          if (w1 < 0) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < 0) continue;
          const z = w0 * za + w1 * zb + w2 * zc;
          const k = row + x;
          if (z > invz[k]) { invz[k] = z; tri[k] = t; b1[k] = w1; b2[k] = w2; }
        }
      }
    }
    const _t1 = performance.now();
    // ---- shade (once per pixel where all samples see the same triangle) ----
    const pc = this.pc, pz = this.pz, pp = this.pp, out = this.tmp, ks = new Int32Array(4);
    const ppRaw = this.ppRaw || (this.ppRaw = new Uint8Array(MAXW * MAXH));
    this.camPos = cam.pos;
    this.fr = sk.fr;
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const k0 = 2 * py * W2 + 2 * px;
        ks[0] = k0; ks[1] = k0 + 1; ks[2] = k0 + W2; ks[3] = k0 + W2 + 1;
        let cov = 0, t0 = -2, same = true, zs = 0;
        for (const k of ks) { if (tri[k] >= 0) { cov++; zs += invz[k]; if (t0 === -2) t0 = tri[k]; else if (tri[k] !== t0) same = false; } }
        const pi = py * MAXW + px;
        if (cov === 0) { pc[4 * pi + 3] = 0; pz[pi] = 0; continue; }
        pz[pi] = zs / cov;
        { const tp = this.TP[t0]; pp[pi] = tp === 6 || tp === 7 ? 0 : tp; ppRaw[pi] = tp; }
        let r = 0, g = 0, b = 0, a = 0;
        if (same) {
          let sb1 = 0, sb2 = 0;
          for (const k of ks) if (tri[k] >= 0) { sb1 += b1[k]; sb2 += b2[k]; }
          this.shade(t0, sb1 / cov, sb2 / cov, out);
          r = out[0]; g = out[1]; b = out[2]; a = out[3] * cov / 4;
        } else {
          for (const k of ks) if (tri[k] >= 0) { this.shade(tri[k], b1[k], b2[k], out); r += out[0]; g += out[1]; b += out[2]; a += out[3]; }
          r /= cov; g /= cov; b /= cov; a /= 4;
        }
        pc[4 * pi] = r; pc[4 * pi + 1] = g; pc[4 * pi + 2] = b; pc[4 * pi + 3] = a * sk.alpha;
      }
    }
    const _t2 = performance.now();
    const _t2b = performance.now();
    // ---- soften intersection seams (finger meeting palm/web): blur colour where neighbouring
    //      pixels belong to different parts at nearly the same depth ----
    {
      const seam = this.seam || (this.seam = new Uint8Array(MAXW * MAXH));
      for (let py = 1; py < bh - 1; py++) for (let px = 1; px < bw - 1; px++) {
        const pi = py * MAXW + px;
        seam[pi] = 0;
        if (pz[pi] <= 0) continue;
        const z = 1 / pz[pi];
        for (const qi of [pi + 1, pi - 1, pi + MAXW, pi - MAXW]) {
          if (pz[qi] > 0 && this.TPpix(qi) !== this.TPpix(pi) && Math.abs(1 / pz[qi] - z) < 4) { seam[pi] = 1; break; }
        }
      }
      const R = 2;
      const src = this.pc2 || (this.pc2 = new Float32Array(MAXW * MAXH * 4));
      src.set(pc.subarray(0, 4 * MAXW * bh));
      for (let py = R; py < bh - R; py++) for (let px = R; px < bw - R; px++) {
        const pi = py * MAXW + px;
        let near = false;
        for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) if (seam[pi + dy * MAXW + dx]) { near = true; break; }
        if (!near) continue;
        let r = 0, g = 0, b = 0, w = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const qi = pi + dy * MAXW + dx;
          if (src[4 * qi + 3] <= 0 || Math.abs(1 / pz[qi] - 1 / pz[pi]) > 6) continue;
          const ww = 1 / (1 + dx * dx + dy * dy);
          r += src[4 * qi] * ww; g += src[4 * qi + 1] * ww; b += src[4 * qi + 2] * ww; w += ww;
        }
        if (w > 0) { pc[4 * pi] = r / w; pc[4 * pi + 1] = g / w; pc[4 * pi + 2] = b / w; }
      }
    }
    this._seamT = performance.now() - _t2b;
    // ---- soft engraved contour where depth jumps (finger over finger, silhouette) ----
    const img = this.c2.createImageData(bw, bh), d = img.data;
    for (let py = 0; py < bh; py++) for (let px = 0; px < bw; px++) {
      const pi = py * MAXW + px, o = 4 * (py * bw + px);
      const a = pc[4 * pi + 3];
      if (a <= 0) { d[o + 3] = 0; continue; }
      let r = pc[4 * pi], g = pc[4 * pi + 1], b = pc[4 * pi + 2];
      const z = pz[pi];
      let edge = 0;
      if (z > 0) {
        const zr = 1 / z;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const qx = px + dx, qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= bw || qy >= bh) { edge = Math.max(edge, 0.5); continue; }
          const qi = qy * MAXW + qx, qz = pz[qi];
          if (qz <= 0) edge = Math.max(edge, 0.55);
          else if (pp[qi] !== pp[pi]) { const dz = 1 / qz - zr; if (dz > 5) edge = Math.max(edge, Math.min(1, (dz - 5) / 10)); }
        }
      }
      if (edge > 0) { const k = 0.42 * edge; r = lerp(r, 0.26, k); g = lerp(g, 0.14, k); b = lerp(b, 0.09, k); }
      d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255; d[o + 3] = Math.min(1, a) * 255;
    }
    this.c2.putImageData(img, 0, 0);
    ctx.drawImage(this.canvas, 0, 0, bw, bh, x0, y0, bw, bh);
    const _t3 = performance.now();
    this.prof = { raster: _t1 - _t0, shade: _t2 - _t1, seam: this._seamT, post: _t3 - _t2, bw, bh };
    return true;
  }

  TPpix(pi) { return this.ppRaw[pi]; }

  shade(t, w1, w2, out) {
    const { T, N, U, V, AL, P, TP, info } = this;
    const i0 = T[3 * t], i1 = T[3 * t + 1], i2 = T[3 * t + 2], w0 = 1 - w1 - w2;
    let nx = N[3 * i0] * w0 + N[3 * i1] * w1 + N[3 * i2] * w2;
    let ny = N[3 * i0 + 1] * w0 + N[3 * i1 + 1] * w1 + N[3 * i2 + 1] * w2;
    let nz = N[3 * i0 + 2] * w0 + N[3 * i1 + 2] * w1 + N[3 * i2 + 2] * w2;
    const u = U[i0] * w0 + U[i1] * w1 + U[i2] * w2, v = V[i0] * w0 + V[i1] * w1 + V[i2] * w2;
    const al = AL[i0] * w0 + AL[i1] * w1 + AL[i2] * w2;
    const px = P[3 * i0] * w0 + P[3 * i1] * w1 + P[3 * i2] * w2;
    const py = P[3 * i0 + 1] * w0 + P[3 * i1 + 1] * w1 + P[3 * i2 + 1] * w2;
    const pz = P[3 * i0 + 2] * w0 + P[3 * i1 + 2] * w1 + P[3 * i2 + 2] * w2;
    const part = TP[t];
    let ar = 0.9, ag = 0.74, ab = 0.64, ao = 1, ks = 0.11, kp = 22, red = 0, tint = 0;
    const fr = this.fr;
    if (part >= 1 && part <= 5) {
      const o = part * 12, sM = info[o], sP = info[o + 1], sD = info[o + 2], L = info[o + 3];
      const th = v * TAU, dors = Math.sin(th);
      red = 0.3 * smooth((u - sD) / (L - sD + 4)) + (0.16 * Math.exp(-(((u - sP) / 4) ** 2)) + 0.1 * Math.exp(-(((u - sD) / 3) ** 2))) * Math.max(0, dors);
      ao *= 1 - (0.3 * (1 - smooth((u - sM + 8) / 16))) * (1 - Math.max(0, dors));   // only the sides/underside darken at the base
      ao *= 0.8 + 0.2 * (0.5 + 0.5 * dors);
      if (dors > 0.2 && part !== 1) {        // knuckle creases, stronger when the joint is straight
        const ext = 1 - Math.min(1, info[o + 4] / 1.2), ext2 = 1 - Math.min(1, info[o + 5] / 0.9);
        let c = 0;
        c += Math.exp(-(((u - sP + 1.7) / 0.42) ** 2)) + Math.exp(-(((u - sP) / 0.42) ** 2)) + Math.exp(-(((u - sP - 1.6) / 0.42) ** 2));
        c *= 0.3 + 0.7 * ext;
        let c2 = 0;
        c2 += Math.exp(-(((u - sD + 0.9) / 0.35) ** 2)) + Math.exp(-(((u - sD - 0.8) / 0.35) ** 2));
        c += c2 * (0.3 + 0.7 * ext2) * 0.8;
        const kk = 0.15 * c * dors * dors;
        ar *= 1 - kk; ag *= 1 - kk * 1.15; ab *= 1 - kk * 1.2;
      }
      // fingernail
      const rc = info[o + 7], l3 = L - sD;
      const a0 = L - 0.6 * l3, a1 = L + 0.42 * rc;
      const na = (u - a0) / (a1 - a0), nb = (th - Math.PI / 2) / (part === 1 ? 0.95 : 0.9);
      if (na > 0 && na < 1 && nb > -1 && nb < 1 && (na > 0.22 || nb * nb + ((0.22 - na) / 0.22) ** 2 < 1)) {
        const edge = Math.min(1 - Math.abs(nb), na < 0.22 ? 1 - Math.sqrt(nb * nb + ((0.22 - na) / 0.22) ** 2) : 1, (1 - na) * 3);
        let cr = 0.95, cg = 0.78, cb = 0.73;
        if (na < 0.3 && nb * nb + (na / 0.3) ** 2 < 1) { cr = 0.97; cg = 0.88; cb = 0.84; }
        if (na > 0.86) { const k = smooth((na - 0.86) / 0.06); cr = lerp(cr, 0.99, k); cg = lerp(cg, 0.95, k); cb = lerp(cb, 0.88, k); }
        const k = smooth(edge / 0.12);
        ar = lerp(ar * 0.78, cr, k); ag = lerp(ag * 0.7, cg, k); ab = lerp(ab * 0.68, cb, k);
        ks = lerp(0.1, 0.5, k); kp = lerp(14, 70, k); red = 0;
      }
    } else if (part === 0) {
      const top = nx * fr.U[0] + ny * fr.U[1] + nz * fr.U[2];
      if (top > 0) {
        const tt = u, ext = 1 - Math.min(1, Math.max(0, info[0]) / 0.9);
        const win = smooth((tt - 0.22) / 0.2) * (1 - smooth((tt - 0.88) / 0.08));
        let dg = 0, ridge = 0;
        for (let f = 2; f <= 5; f++) {
          const xf = lerp(TENDON_W[f], ANAT.mcp[f][0], Math.pow(tt, 0.8));
          const q = (v - xf) / 3.4, e = Math.exp(-q * q);
          dg += -2 * q / 3.4 * e; ridge += e;
        }
        const kt = (0.5 + 0.6 * ext) * win * top;
        nx -= fr.L[0] * dg * kt * 0.55; ny -= fr.L[1] * dg * kt * 0.55; nz -= fr.L[2] * dg * kt * 0.55;
        ar *= 1 + 0.02 * ridge * kt;
        const vx = -12 * HS + 5 * Math.sin(tt * 6.5) + 9 * tt, vein = Math.exp(-(((v - vx) / 2.2) ** 2)) * smooth((tt - 0.1) / 0.3) * (1 - smooth((tt - 0.75) / 0.15));
        const vx2 = 10 * HS + 4 * Math.sin(tt * 5 + 1), vein2 = Math.exp(-(((v - vx2) / 1.8) ** 2)) * smooth((tt - 0.15) / 0.3) * (1 - smooth((tt - 0.6) / 0.2));
        tint = 0.5 * vein + 0.35 * vein2;
        for (let f = 2; f <= 5; f++) red += 0.12 * Math.exp(-(((v - ANAT.mcp[f][0]) / 8) ** 2)) * smooth((tt - 0.82) / 0.12);
        ao *= 0.86 + 0.14 * (1 - smooth((tt - 0.9) / 0.1));
      } else ao *= 0.78;
    } else if (part === 6) {
      ao *= 0.86;
    } else if (part === 7) {
      ar *= 0.97; ag *= 0.97;
    }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const mott = (vnoise(u * 0.35 + part * 13, v * 9 + part * 7) - 0.5) * 0.05;
    ar += mott; ag += mott * 0.9; ab += mott * 0.8;
    ag *= 1 - 0.17 * red; ab *= 1 - 0.15 * red;
    ar *= 1 - 0.05 * tint; ag *= 1 - 0.06 * tint; ab *= 1 + 0.03 * tint;
    // lighting
    const cp = this.camPos;
    let vx = cp[0] - px, vy = cp[1] - py, vz = cp[2] - pz;
    const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
    const dk = nx * LK[0] + ny * LK[1] + nz * LK[2];
    const dR = Math.max(0, (dk + 0.42) / 1.42), dG = Math.max(0, (dk + 0.24) / 1.24), dB = Math.max(0, (dk + 0.17) / 1.17);
    const df = Math.max(0, (nx * LF[0] + ny * LF[1] + nz * LF[2] + 0.2) / 1.2);
    const nv = Math.max(0, nx * vx + ny * vy + nz * vz);
    const rim = Math.max(0, nx * LR[0] + ny * LR[1] + nz * LR[2]) * Math.pow(1 - nv, 1.6);
    const hemi = 0.5 + 0.5 * nz;
    const ambR = 0.15 * hemi + 0.05 * (1 - hemi), ambG = 0.12 * hemi + 0.035 * (1 - hemi), ambB = 0.1 * hemi + 0.03 * (1 - hemi);
    let hx = LK[0] + vx, hy = LK[1] + vy, hz = LK[2] + vz;
    const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
    const nh = Math.max(0, nx * hx + ny * hy + nz * hz);
    const fres = 0.35 + 0.65 * Math.pow(1 - nv, 4);
    const spec = ks * Math.pow(nh, kp) * fres * (dk > 0 ? 1 : 0.3);
    let r = ar * (CK[0] * dR * 0.95 + CF[0] * df + ambR) * ao + CR[0] * rim * 0.42 + spec * CK[0];
    let g = ag * (CK[1] * dG * 0.95 + CF[1] * df + ambG) * ao + CR[1] * rim * 0.42 + spec * CK[1];
    let b = ab * (CK[2] * dB * 0.95 + CF[2] * df + ambB) * ao + CR[2] * rim * 0.42 + spec * CK[2];
    out[0] = r > 0.82 ? 0.82 + 0.18 * (1 - Math.exp(-(r - 0.82) / 0.18)) : r;
    out[1] = g > 0.82 ? 0.82 + 0.18 * (1 - Math.exp(-(g - 0.82) / 0.18)) : g;
    out[2] = b > 0.82 ? 0.82 + 0.18 * (1 - Math.exp(-(b - 0.82) / 0.18)) : b;
    out[3] = al;
  }
}

// Soft shadow of the hand thrown on the keys by the lamp (projected along the light).
export const LIGHT3D = n3([0.42, 0.62, -1]);
const toPlane = (p) => { const k = p[2] / -LIGHT3D[2]; return [p[0] + LIGHT3D[0] * k, p[1] + LIGHT3D[1] * k, 0]; };
function capsule2(ctx, A, B, ra, rb) {
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
  if (L < 0.5) { ctx.moveTo(A[0] + ra, A[1]); ctx.arc(A[0], A[1], Math.max(ra, rb), 0, TAU); return; }
  const ang = Math.atan2(dy, dx), d = Math.asin(Math.max(-0.95, Math.min(0.95, (ra - rb) / L)));
  ctx.moveTo(A[0] + ra * Math.cos(ang + Math.PI / 2 + d), A[1] + ra * Math.sin(ang + Math.PI / 2 + d));
  ctx.arc(A[0], A[1], ra, ang + Math.PI / 2 + d, ang + (3 * Math.PI) / 2 - d);
  ctx.arc(B[0], B[1], rb, ang - Math.PI / 2 - d, ang + Math.PI / 2 + d);
  ctx.closePath();
}
export function drawHandShadow(ctx, cam, sk, scale) {
  if (sk.alpha <= 0.01) return;
  ctx.globalAlpha = sk.alpha;
  ctx.beginPath();
  for (let f = 1; f <= 5; f++) {
    const F = sk.fingers[f];
    const P = F.pts.map((p) => cam.project(toPlane(p)));
    const r = f === 1 ? [13, 11, 10, 9] : [ANAT.rad[f][0], ANAT.rad[f][0] * 0.95, ANAT.rad[f][1], ANAT.rad[f][1]];
    for (let k = 0; k + 1 < P.length; k++) capsule2(ctx, [P[k][0] * scale, P[k][1] * scale], [P[k + 1][0] * scale, P[k + 1][1] * scale], r[k] * P[k][3] * scale, r[k + 1] * P[k + 1][3] * scale);
  }
  const outline = [[-38, -16], [-30, -60], [-22, -96], [24, -96], [40, -60], [48, -26], [36, -10], [0, 4], [-23, 2]].map(([x, y]) => {
    const q = cam.project(toPlane(sk.fr.w([x * HS, y * HS, 0]))); return [q[0] * scale, q[1] * scale];
  });
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (const p of outline.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  const W0 = cam.project(toPlane(sk.wrist)), W1 = cam.project(toPlane(addk(sk.wrist, sk.elbowDir, 120)));
  capsule2(ctx, [W0[0] * scale, W0[1] * scale], [W1[0] * scale, W1[1] * scale], 30 * W0[3] * scale, 34 * W1[3] * scale);
  ctx.fill();
  ctx.globalAlpha = 1;
}
// Dark contact patches where fingertips meet the keys.
export function drawContactShadows(ctx, cam, sk) {
  if (sk.alpha <= 0.01) return;
  for (let f = 1; f <= 5; f++) {
    const F = sk.fingers[f];
    const tip = F.pts[F.pts.length - 1];
    const r = ANAT.rad[f][1];
    const keyZ = F.note ? (F.note.midi % 12 === 1 || F.note.midi % 12 === 3 || F.note.midi % 12 === 6 || F.note.midi % 12 === 8 || F.note.midi % 12 === 10 ? 12 : 0) : 0;
    const gap = tip[2] - r - keyZ;
    if (gap > 14) continue;
    const k = (1 - Math.max(0, gap) / 14) * sk.alpha;
    const p = cam.project([tip[0] + 2, tip[1] + 3, keyZ]);
    const rad = (r * 1.5 + Math.max(0, gap) * 0.6) * p[3];
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad);
    g.addColorStop(0, `rgba(30,16,8,${0.4 * k})`); g.addColorStop(1, 'rgba(30,16,8,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p[0], p[1], rad, rad * 0.7, 0, 0, TAU); ctx.fill();
  }
}
