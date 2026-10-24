// Particles, flying note glyphs, light rays and the 1900s film look.
import { keyX, isBlack } from '../keyboard.js';
import { HAND_COL, rgba } from './keysdraw.js';
import { hwPoint } from './notesdraw.js';
import { clipSegment } from './camera.js';
import { mulberry32, clamp, noise1, lowerBound } from '../util.js';

// Ballistic motion with linear drag (analytic, so any frame can be rendered independently).
function ballistic(p0, v0, g, k, tau) {
  const e = Math.exp(-k * tau);
  const a = (1 - e) / k, b = tau / k - (1 - e) / (k * k);
  return [p0[0] + v0[0] * a, p0[1] + v0[1] * a, p0[2] + v0[2] * a - g * b];
}

export function drawImpacts(ctx, cam, t, notesByOn) {
  const from = lowerBound(notesByOn, t - 1.5, (n) => n.on);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = from; i < notesByOn.length; i++) {
    const n = notesByOn[i];
    if (n.on > t) break;
    const tau = t - n.on;
    const C = HAND_COL[n.hand];
    const x = keyX(n.midi);
    const rnd = mulberry32(n.id * 7919 + 17);
    const boost = n.role === 'bell' ? 1.6 : 1;
    // shock ring on the highway around the landing point
    if (tau < 0.5) {
      const k = 1 - tau / 0.5;
      const r = 5 + 80 * Math.pow(tau, 0.55) * (0.6 + 0.6 * n.vel) * boost;
      ctx.strokeStyle = rgba(C.glow, 0.5 * k * k * (0.35 + n.vel));
      ctx.lineWidth = Math.max(0.8, 2.2 * k * cam.project(hwPoint(x, 0))[3]);
      ctx.beginPath();
      for (let j = 0; j <= 28; j++) {
        const a = (j / 28) * Math.PI;
        const p = cam.project(hwPoint(x + Math.cos(a) * r, Math.sin(a) * r * 0.9, 1));
        if (j === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
    // sparks of gold dust / blue fire
    const count = Math.round((3 + 20 * n.vel * n.vel) * boost);
    for (let j = 0; j < count; j++) {
      const life = 0.35 + 0.95 * rnd();
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      if (tau > life) continue;
      const sp = 0.4 + 0.9 * n.vel;
      const v0 = [(r1 - 0.5) * 320 * sp, (60 + 360 * r2) * sp, (220 + 900 * r3) * sp];
      const p0 = hwPoint(x + (r4 - 0.5) * (isBlack(n.midi) ? 9 : 16), 1, 3);
      const a = ballistic(p0, v0, 1500, 2.8, Math.max(0, tau - 0.035)), b = ballistic(p0, v0, 1500, 2.8, tau);
      const A = cam.project(a), B = cam.project(b);
      const fade = (1 - tau / life) ** 1.4;
      const hot = Math.max(0, 1 - tau / (life * 0.5));
      const col = [C.glow[0] + (255 - C.glow[0]) * hot, C.glow[1] + (255 - C.glow[1]) * hot, C.glow[2] + (255 - C.glow[2]) * hot];
      ctx.strokeStyle = rgba(col, fade * (0.45 + 0.55 * n.vel));
      ctx.lineWidth = Math.max(0.7, (0.6 + 1.3 * r1) * B[3]);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
  }
  // slow embers above held keys
  ctx.globalCompositeOperation = 'source-over';
}

export function drawEmbers(ctx, cam, t, held) {
  ctx.globalCompositeOperation = 'lighter';
  for (const n of held) {
    if (n.vel < 0.25) continue;
    const C = HAND_COL[n.hand];
    const x = keyX(n.midi);
    const rate = 5 + 10 * n.vel;
    const first = Math.ceil((t - 1.3 - n.on) * rate);
    const last = Math.floor((Math.min(t, n.keyUp) - n.on) * rate);
    for (let i = Math.max(0, first); i <= last; i++) {
      const born = n.on + i / rate, tau = t - born;
      if (tau < 0 || tau > 1.3) continue;
      const rnd = mulberry32(n.id * 131 + i * 7);
      const dx = (rnd() - 0.5) * 14 + 9 * noise1(born * 3 + tau * 1.5, n.id);
      const p = cam.project(hwPoint(x + dx, 2 + 40 * tau + 10 * rnd(), 4 + 70 * tau * (0.6 + rnd())));
      const a = (1 - tau / 1.3) ** 1.5 * 0.6;
      const r = Math.max(0.8, (0.8 + rnd()) * p[3]);
      ctx.fillStyle = rgba(C.glow, a);
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Engraved eighth-note glyph (♪ / ♫) drawn as vectors.
function glyphPath(ctx, kind) {
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.62, 0.44, -0.42, 0, Math.PI * 2);
  if (kind === 1) ctx.ellipse(1.7, -0.35, 0.62, 0.44, -0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.16;
  ctx.beginPath(); ctx.moveTo(0.55, -0.15); ctx.lineTo(0.55, -2.6);
  if (kind === 1) {
    ctx.moveTo(2.25, -0.5); ctx.lineTo(2.25, -2.95);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.47, -2.6); ctx.lineTo(2.33, -2.95); ctx.lineTo(2.33, -2.5); ctx.lineTo(0.47, -2.15); ctx.closePath(); ctx.fill();
  } else {
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.55, -2.6);
    ctx.bezierCurveTo(0.7, -1.9, 1.6, -1.7, 1.35, -0.75);
    ctx.bezierCurveTo(1.5, -1.5, 1.0, -1.9, 0.55, -2.0);
    ctx.closePath(); ctx.fill();
  }
}

export function drawFlyingGlyphs(ctx, cam, t, glyphNotes) {
  const from = lowerBound(glyphNotes, t - 2.4, (n) => n.on);
  for (let i = from; i < glyphNotes.length; i++) {
    const n = glyphNotes[i];
    if (n.on > t) break;
    const tau = t - n.on;
    const rnd = mulberry32(n.id * 4441 + 3);
    const life = 1.7 + 0.7 * rnd();
    if (tau > life) continue;
    const C = HAND_COL[n.hand];
    const x = keyX(n.midi);
    const v0 = [(rnd() - 0.5) * 240, -(380 + 260 * rnd()), 420 + 300 * rnd() * (0.5 + n.vel)];
    const p0 = hwPoint(x, 6, 12);
    const p = ballistic(p0, v0, 260, 0.55, tau);
    const seg = clipSegment(cam, p, p);
    if (!seg || cam.depth(p) < cam.near * 2) continue;
    const P = cam.project(p);
    const size = (13 + 9 * rnd()) * (0.8 + 0.5 * n.vel) * P[3];
    if (size > 260) continue;
    const fade = Math.min(1, tau / 0.12) * (1 - tau / life) ** 1.3 * (1 - clamp((size - 120) / 140));
    const rot = (rnd() - 0.5) * 0.6 + (rnd() - 0.5) * 2.4 * tau;
    ctx.save();
    ctx.translate(P[0], P[1]);
    // halo
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(0, -size * 0.9, 0, 0, -size * 0.9, size * 2.2);
    hg.addColorStop(0, rgba(C.glow, 0.32 * fade)); hg.addColorStop(1, rgba(C.glow, 0));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, -size * 0.9, size * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(rot);
    ctx.scale(size, size);
    ctx.globalAlpha = fade;
    const kind = rnd() < 0.4 ? 1 : 0;
    ctx.fillStyle = 'rgba(25,14,6,0.9)'; ctx.strokeStyle = 'rgba(25,14,6,0.9)';
    ctx.save(); ctx.translate(0.07, 0.07); glyphPath(ctx, kind); ctx.restore();
    ctx.fillStyle = rgba(C.light, 1); ctx.strokeStyle = rgba(C.light, 1);
    glyphPath(ctx, kind);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

export function drawRays(ctx, W, H, t, energy) {
  if (energy < 0.02) return;
  ctx.globalCompositeOperation = 'lighter';
  const ox = W * 0.5 + 60 * noise1(t * 0.1, 5), oy = -H * 0.18;
  for (let i = 0; i < 7; i++) {
    const a = -0.42 + i * 0.14 + 0.05 * noise1(t * 0.23 + i * 3.1, 77);
    const w = 0.035 + 0.025 * (0.5 + 0.5 * noise1(t * 0.3 + i, 11));
    const len = H * 1.25;
    const g = ctx.createLinearGradient(ox, oy, ox + Math.sin(a) * len, oy + Math.cos(a) * len);
    const al = energy * (0.06 + 0.05 * (0.5 + 0.5 * noise1(t * 0.7 + i * 5, 3)));
    g.addColorStop(0, `rgba(255,214,150,${al})`); g.addColorStop(0.55, `rgba(255,200,130,${al * 0.5})`); g.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.sin(a - w) * len, oy + Math.cos(a - w) * len);
    ctx.lineTo(ox + Math.sin(a + w) * len, oy + Math.cos(a + w) * len);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function drawFlash(ctx, W, H, cx, cy, k, col) {
  if (k <= 0.005) return;
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, H * 0.75);
  g.addColorStop(0, rgba(col, 0.4 * k)); g.addColorStop(0.4, rgba(col, 0.12 * k)); g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

// 1900s film: warm grade, vignette, grain, flicker, dust, hairs and scratches.
export function drawFilm(ctx, W, H, t, frame, plates) {
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(196,150,92,0.32)';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(plates.vignette, 0, 0);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.11;
  const g = plates.grain[frame % plates.grain.length];
  const ox = (frame * 37) % 7, oy = (frame * 53) % 9;
  ctx.drawImage(g, -ox, -oy, W + 9, H + 12);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const flick = 0.022 + 0.022 * noise1(t * 11, 21) + 0.01 * noise1(t * 37, 8);
  ctx.fillStyle = `rgba(20,10,4,${Math.max(0, flick)})`;
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(frame * 2654435761 >>> 0);
  const specks = Math.floor(rnd() * 3.4);
  for (let i = 0; i < specks; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.8 + rnd() ** 2 * 3.2;
    ctx.fillStyle = rnd() < 0.75 ? `rgba(18,10,5,${0.35 + rnd() * 0.4})` : `rgba(255,244,220,${0.25 + rnd() * 0.3})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  if (rnd() < 0.05) { // a stray hair in the gate
    const x = rnd() * W, y = rnd() * H, l = 20 + rnd() * 70;
    ctx.strokeStyle = 'rgba(15,8,4,0.45)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + (rnd() - 0.5) * l, y + l * 0.3, x + (rnd() - 0.5) * l, y + l * 0.7, x + (rnd() - 0.5) * l * 0.5, y + l);
    ctx.stroke();
  }
  // persistent vertical scratches that wander slowly
  for (let s = 0; s < 2; s++) {
    const seg = Math.floor(t / 2.7 + s * 0.5);
    const r2 = mulberry32(seg * 31 + s * 7);
    if (r2() > 0.55) continue;
    const x = r2() * W + 6 * noise1(t * 2, s * 13);
    const a = 0.08 + 0.1 * r2();
    ctx.strokeStyle = `rgba(255,240,210,${a})`; ctx.lineWidth = 0.7 + r2();
    ctx.beginPath();
    let y = r2() * H * 0.3;
    while (y < H) { const l = 60 + r2() * 300; ctx.moveTo(x, y); ctx.lineTo(x + 0.6, y + l); y += l + r2() * 120; }
    ctx.stroke();
  }
}
