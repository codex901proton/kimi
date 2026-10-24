// The note highway: gilded / enamel note slabs flying toward the keys in perspective.
import { W, WHITE_L, isBlack, keyX, noteName, LOW, HIGH, whiteIndex } from '../keyboard.js';
import { HAND_COL, rgba } from './keysdraw.js';
import { clamp, smoothstep } from '../util.js';

export const HW = { y0: WHITE_L + 9, z0: 7, phi: (24 * Math.PI) / 180 };
export function hwPoint(x, s, n = 0) {
  const c = Math.cos(HW.phi), sn = Math.sin(HW.phi);
  return [x, HW.y0 + s * c - n * sn, HW.z0 + s * sn + n * c];
}

// Visible length of the highway (mm) for the current camera: where it leaves the top of the frame.
export function visibleLength(cam) {
  let lo = 0, hi = 20000;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    const p = cam.project(hwPoint(cam.target[0], m, 0));
    if (p[1] > -20 && cam.depth(hwPoint(cam.target[0], m, 0)) > 0) lo = m; else hi = m;
  }
  return lo;
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const FOG = [46, 30, 20];

export function drawLanes(ctx, cam, view, t, bars, markings, fonts) {
  const { sVis, xL, xR } = view;
  // Lane rules at every C (solid) and F (dotted), converging in the distance.
  for (let m = LOW; m <= HIGH; m++) {
    const pc = m % 12;
    if (pc !== 0 && pc !== 5) continue;
    const x = whiteIndex(m) * W;
    if (x < xL - 30 || x > xR + 30) continue;
    const a = cam.project(hwPoint(x, 0)), b = cam.project(hwPoint(x, sVis));
    const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
    const al = pc === 0 ? (m === 60 ? 0.3 : 0.2) : 0.1;
    g.addColorStop(0, `rgba(232,190,110,${al})`); g.addColorStop(1, 'rgba(232,190,110,0)');
    ctx.strokeStyle = g; ctx.lineWidth = pc === 0 ? 1.2 : 0.8;
    if (pc === 5) ctx.setLineDash([3, 7]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Bar lines with engraved numbers.
  bars.forEach((bt, i) => {
    const s = (bt - t) * view.speed;
    if (s < 2 || s > sVis) return;
    const fade = (1 - smoothstep((s / sVis - 0.7) / 0.3)) * smoothstep(s / 40);
    const a = cam.project(hwPoint(xL - 10, s)), b = cam.project(hwPoint(xR + 10, s));
    ctx.strokeStyle = `rgba(226,186,112,${0.22 * fade})`; ctx.lineWidth = Math.max(0.6, 0.7 * a[3]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    const np = cam.project(hwPoint(xL + 14, s + 3, 0));
    ctx.font = `italic ${(9 * np[3]).toFixed(1)}px "Old Standard TT"`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = `rgba(226,190,120,${0.55 * fade})`;
    ctx.fillText(String(i + 2), np[0], np[1]);
  });
  // Dynamic marks travelling with the music.
  for (const mk of markings) {
    const s = (mk.t - t) * view.speed;
    if (s < -20 || s > sVis) continue;
    const fade = (1 - smoothstep((s / sVis - 0.65) / 0.35)) * smoothstep((s + 20) / 60);
    const p = cam.project(hwPoint(xR - 22, s + 2, 0));
    const isWord = mk.text.endsWith('.');
    ctx.font = `${isWord ? 'italic' : 'bold italic'} ${((isWord ? 13 : 19) * p[3]).toFixed(1)}px "Old Standard TT"`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(1, 2.2 * p[3]);
    ctx.strokeStyle = `rgba(20,12,6,${0.55 * fade})`;
    ctx.strokeText(mk.text, p[0], p[1]);
    ctx.fillStyle = `rgba(246,214,150,${0.92 * fade})`;
    ctx.fillText(mk.text, p[0], p[1]);
  }
}

// Notes: [{midi, hand, on, keyUp, soundEnd, vel}] visible in [t, t + look].
export function drawNotes(ctx, cam, view, t, notes, fonts) {
  const { sVis, speed } = view;
  const camX = cam.pos[0];
  const items = [];
  for (const n of notes) {
    const s0 = (n.on - t) * speed, s1 = (n.keyUp - t) * speed, s2 = (n.soundEnd - t) * speed;
    if (s2 < 0 || s0 > sVis) continue;
    items.push({ n, s0: Math.max(0, s0), s1, s2, raw0: s0 });
  }
  items.sort((a, b) => b.s0 - a.s0 || Math.abs(keyX(b.n.midi) - camX) - Math.abs(keyX(a.n.midi) - camX));
  // pedal-sustained resonance trails first (behind everything)
  for (const it of items) {
    const { n } = it;
    const a0 = Math.max(0, it.s1), a1 = Math.min(sVis, it.s2);
    if (a1 - a0 < 4) continue;
    const C = HAND_COL[n.hand];
    const x = keyX(n.midi), hw = isBlack(n.midi) ? 1.6 : 2.2;
    const pts = [hwPoint(x - hw, a0), hwPoint(x + hw, a0), hwPoint(x + hw * 0.3, a1), hwPoint(x - hw * 0.3, a1)].map((p) => cam.project(p));
    const g = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[3][0], pts[3][1]);
    g.addColorStop(0, rgba(C.glow, 0.22 * (0.4 + n.vel))); g.addColorStop(1, rgba(C.glow, 0));
    poly(ctx, pts); ctx.fillStyle = g; ctx.fill();
  }
  for (const it of items) {
    const { n, s0 } = it;
    const s1 = Math.min(it.s1, sVis + 40);
    if (s1 <= s0 + 0.5) continue;
    const black = isBlack(n.midi);
    const x = keyX(n.midi), hw = black ? 5.6 : 9.2, th = black ? 5 : 4.2;
    const C = HAND_COL[n.hand];
    const fogK = clamp(s0 / sVis) ** 1.6 * 0.55;
    const alpha = 1 - smoothstep((s0 / sVis - 0.82) / 0.18);
    if (alpha <= 0.01) continue;
    const vk = 0.72 + 0.28 * n.vel;
    const light = mix(mix(C.light, [255, 255, 255], 0.1), FOG, fogK), base = mix(C.base, FOG, fogK), dark = mix(C.dark, FOG, fogK);
    const c = [hwPoint(x - hw, s0, th), hwPoint(x + hw, s0, th), hwPoint(x + hw, s1, th), hwPoint(x - hw, s1, th)].map((p) => cam.project(p));
    const cb = [hwPoint(x - hw, s0, 0), hwPoint(x + hw, s0, 0)].map((p) => cam.project(p));
    ctx.globalAlpha = alpha;
    // side wall facing the camera
    if (camX < x - hw || camX > x + hw) {
      const sx = camX < x ? x - hw : x + hw;
      const side = [hwPoint(sx, s0, 0), hwPoint(sx, s1, 0), hwPoint(sx, s1, th), hwPoint(sx, s0, th)].map((p) => cam.project(p));
      poly(ctx, side); ctx.fillStyle = rgba(dark, 1); ctx.fill();
    }
    // near end-cap
    poly(ctx, [cb[0], cb[1], c[1], c[0]]); ctx.fillStyle = rgba(mix(base, dark, 0.45), 1); ctx.fill();
    // top face with cylindrical lamp-light shading
    poly(ctx, c);
    const mL = [(c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2], mR = [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2];
    let g = ctx.createLinearGradient(mL[0], mL[1], mR[0], mR[1]);
    g.addColorStop(0, rgba(dark, 1)); g.addColorStop(0.18, rgba(base, 1)); g.addColorStop(0.38, rgba(light, vk));
    g.addColorStop(0.62, rgba(base, 1)); g.addColorStop(1, rgba(dark, 1));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(24,14,6,0.85)'; ctx.lineWidth = Math.max(0.6, 0.55 * c[0][3]); ctx.stroke();
    // engraved inner border
    const ins = Math.min(2.2, (s1 - s0) * 0.25);
    const ib = [hwPoint(x - hw + 2, s0 + ins, th), hwPoint(x + hw - 2, s0 + ins, th), hwPoint(x + hw - 2, s1 - ins, th), hwPoint(x - hw + 2, s1 - ins, th)].map((p) => cam.project(p));
    poly(ctx, ib); ctx.strokeStyle = rgba(mix(dark, [0, 0, 0], 0.3), 0.55); ctx.lineWidth = Math.max(0.4, 0.3 * c[0][3]); ctx.stroke();
    // letter name, embossed near the leading edge
    const len = s1 - s0;
    if (len > 11 && c[0][3] > 0.55) {
      const lp = cam.project(hwPoint(x, s0 + 6.5, th));
      const fs = (black ? 6.4 : 8.6) * lp[3];
      ctx.font = `bold ${fs.toFixed(1)}px "Old Standard TT"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const name = noteName(n.midi);
      ctx.fillStyle = rgba(mix(light, [255, 255, 255], 0.5), 0.5);
      ctx.fillText(name, lp[0] + 0.5, lp[1] + 0.6);
      ctx.fillStyle = rgba(mix(dark, [10, 5, 0], 0.5), 0.92);
      ctx.fillText(name, lp[0], lp[1]);
    }
    ctx.globalAlpha = 1;
    // landing glow on the felt rim while the key is down
    if (it.raw0 <= 0 && it.s1 > 0) {
      const p = cam.project(hwPoint(x, 0, 2));
      const r = (black ? 20 : 26) * p[3] * (0.8 + 0.5 * n.vel);
      const rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
      rg.addColorStop(0, rgba([255, 250, 230], 0.75)); rg.addColorStop(0.25, rgba(C.glow, 0.45)); rg.addColorStop(1, rgba(C.glow, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (it.raw0 > 0 && it.raw0 < 60) {
      // approaching: the leading edge starts to shine
      const k = 1 - it.raw0 / 60;
      const p = cam.project(hwPoint(x, s0, th));
      const r = (black ? 12 : 16) * p[3];
      const rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
      rg.addColorStop(0, rgba(C.glow, 0.35 * k)); rg.addColorStop(1, rgba(C.glow, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
