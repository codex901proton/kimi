// Ivory & ebony keyboard with physical key travel, colour state indicators, rosewood key slip.
import { W, WHITE_W, WHITE_L, BLACK_W, BLACK_TOP_W, BLACK_L, BLACK_H, LOW, HIGH, isBlack, keyX, whiteIndex, octaveOf } from '../keyboard.js';
import { dipAt } from './handanim.js';

export const HAND_COL = {
  R: { light: [255, 236, 170], base: [226, 170, 68], dark: [118, 74, 18], glow: [255, 196, 96] },
  L: { light: [196, 222, 255], base: [74, 128, 196], dark: [20, 44, 90], glow: [120, 176, 255] },
};
export const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function quad(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

const FRONT_H = 15;

export function drawKeySlipAndCheeks(ctx, cam) {
  const P = (x, y, z) => cam.project([x, y, z]);
  const x0 = -70, x1 = 52 * W + 70;
  // rosewood key slip
  const top = [P(x0, -7, -15), P(x1, -7, -15), P(x1, -1, -15), P(x0, -1, -15)];
  const front = [P(x0, -7, -15), P(x1, -7, -15), P(x1, -7, -58), P(x0, -7, -58)];
  let g = ctx.createLinearGradient(0, front[0][1], 0, front[2][1]);
  g.addColorStop(0, '#7a4528'); g.addColorStop(0.12, '#4e2715'); g.addColorStop(1, '#22100a');
  quad(ctx, front); ctx.fillStyle = g; ctx.fill();
  quad(ctx, top); ctx.fillStyle = '#8c5533'; ctx.fill();
  // gilded inlay
  const a = P(x0 + 20, -7.2, -24), b = P(x1 - 20, -7.2, -24);
  ctx.strokeStyle = 'rgba(232,188,98,0.75)'; ctx.lineWidth = Math.max(0.8, 1.1 * a[3]);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  const c = P(x0 + 20, -7.2, -50), d = P(x1 - 20, -7.2, -50);
  ctx.lineWidth = Math.max(0.5, 0.5 * a[3]);
  ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke();
  // felt strip and gilded rim behind the keys (the line the notes land on)
  const f0 = [P(-4, WHITE_L, 0), P(52 * W + 4, WHITE_L, 0), P(52 * W + 4, WHITE_L + 9, 7), P(-4, WHITE_L + 9, 7)];
  quad(ctx, f0); ctx.fillStyle = '#5e1414'; ctx.fill();
  const r0 = P(-4, WHITE_L + 9, 7), r1 = P(52 * W + 4, WHITE_L + 9, 7);
  ctx.strokeStyle = 'rgba(246,206,120,0.9)'; ctx.lineWidth = Math.max(1, 1.4 * r0[3]);
  ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
  // carved cheek blocks
  for (const [cx0, cx1] of [[-64, -3], [52 * W + 3, 52 * W + 64]]) {
    const topF = [P(cx0, -8, 26), P(cx1, -8, 26), P(cx1, WHITE_L + 12, 26), P(cx0, WHITE_L + 12, 26)];
    const frontF = [P(cx0, -8, 26), P(cx1, -8, 26), P(cx1, -8, -58), P(cx0, -8, -58)];
    g = ctx.createLinearGradient(frontF[0][0], 0, frontF[1][0], 0);
    g.addColorStop(0, '#2a130b'); g.addColorStop(0.5, '#5b301b'); g.addColorStop(1, '#2a130b');
    quad(ctx, frontF); ctx.fillStyle = g; ctx.fill();
    quad(ctx, topF); ctx.fillStyle = '#6e3d22'; ctx.fill();
    ctx.strokeStyle = 'rgba(232,188,98,0.6)'; ctx.lineWidth = Math.max(0.6, 0.8 * topF[0][3]);
    const s0 = P((cx0 + cx1) / 2, -8.2, 8), sr = 16 * s0[3];
    ctx.beginPath(); ctx.arc(s0[0], s0[1], sr, Math.PI * 0.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(s0[0] + sr * 0.3, s0[1], sr * 0.5, Math.PI * 1.1, Math.PI * 2.8); ctx.stroke();
  }
}

// state(m) → { depth, hand, vel, sustain }
export function drawKeys(ctx, cam, state, fonts, tex) {
  const P = (x, y, z) => cam.project([x, y, z]);
  const visL = cam.unprojectToZ(0, cam.cy, 0)[0] - 40, visR = cam.unprojectToZ(cam.width, cam.cy, 0)[0] + 40;
  const camX = cam.pos[0];
  // White keys.
  for (let m = LOW; m <= HIGH; m++) {
    if (isBlack(m)) continue;
    const xi = whiteIndex(m) * W;
    if (xi + W < visL || xi > visR) continue;
    const x0 = xi + (W - WHITE_W) / 2, x1 = x0 + WHITE_W;
    const st = state(m);
    const dzF = dipAt(st.depth, 0), dzB = dipAt(st.depth, WHITE_L);
    const tFL = P(x0, 0, -dzF), tFR = P(x1, 0, -dzF), tBR = P(x1, WHITE_L, -dzB), tBL = P(x0, WHITE_L, -dzB);
    // front face
    const fL = P(x0, 0, -dzF - FRONT_H), fR = P(x1, 0, -dzF - FRONT_H);
    quad(ctx, [tFL, tFR, fR, fL]);
    let g = ctx.createLinearGradient(0, tFL[1], 0, fL[1]);
    g.addColorStop(0, '#f4ead4'); g.addColorStop(0.25, '#e2d3b2'); g.addColorStop(1, '#a8957a');
    ctx.fillStyle = g; ctx.fill();
    // top face: ivory texture (affine over the quad) + lamp-light gradient
    ctx.save();
    quad(ctx, [tFL, tFR, tBR, tBL]);
    ctx.clip();
    const ax = (tFR[0] - tFL[0]) / 64, ay = (tFR[1] - tFL[1]) / 64, bx = (tBL[0] - tFL[0]) / 256, by = (tBL[1] - tFL[1]) / 256;
    ctx.setTransform(ax, ay, bx, by, tFL[0], tFL[1]);
    ctx.drawImage(tex.ivory, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    g = ctx.createLinearGradient(0, tFL[1], 0, tBL[1]);
    const tint = ((m * 7919) % 13) / 13;
    g.addColorStop(0, `rgba(255,248,232,${0.18 + tint * 0.05})`);
    g.addColorStop(0.55, 'rgba(255,240,210,0)');
    g.addColorStop(1, 'rgba(70,40,20,0.35)');
    ctx.fillStyle = g; ctx.fillRect(Math.min(tFL[0], tBL[0]) - 2, tBL[1] - 2, Math.abs(tFR[0] - tFL[0]) + 8, tFL[1] - tBL[1] + 4);
    if (st.depth > 0.01 && st.hand) {
      const C = HAND_COL[st.hand];
      const k = Math.min(1, st.depth) * (0.55 + 0.45 * st.vel);
      g = ctx.createLinearGradient(0, tFL[1], 0, tBL[1]);
      g.addColorStop(0, rgba(C.light, 0.85 * k));
      g.addColorStop(0.6, rgba(C.base, 0.7 * k));
      g.addColorStop(1, rgba(C.dark, 0.6 * k));
      ctx.fillStyle = g; ctx.fillRect(Math.min(tFL[0], tBL[0]) - 2, tBL[1] - 2, Math.abs(tFR[0] - tFL[0]) + 8, tFL[1] - tBL[1] + 4);
      // the walls of the neighbouring keys revealed by the travel
      const w = Math.max(1.5, (tFR[0] - tFL[0]) * 0.13 * Math.min(1, st.depth));
      for (const [ex, dir] of [[tFL, 1], [tFR, -1]]) {
        const sg = ctx.createLinearGradient(ex[0], 0, ex[0] + dir * w, 0);
        sg.addColorStop(0, 'rgba(40,22,10,0.75)'); sg.addColorStop(1, 'rgba(40,22,10,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(dir > 0 ? ex[0] : ex[0] - w, tBL[1], w, tFL[1] - tBL[1]);
      }
    } else if (st.sustain > 0.01 && st.sHand) {
      const C = HAND_COL[st.sHand];
      g = ctx.createLinearGradient(0, tBL[1], 0, tFL[1]);
      g.addColorStop(0, rgba(C.base, 0.55 * st.sustain));
      g.addColorStop(0.45, rgba(C.base, 0.12 * st.sustain));
      g.addColorStop(1, rgba(C.base, 0));
      ctx.fillStyle = g; ctx.fillRect(Math.min(tFL[0], tBL[0]) - 2, tBL[1] - 2, Math.abs(tFR[0] - tFL[0]) + 8, tFL[1] - tBL[1] + 4);
    }
    ctx.restore();
    // outline / gap
    quad(ctx, [tFL, tFR, tBR, tBL]);
    ctx.strokeStyle = 'rgba(60,38,22,0.75)'; ctx.lineWidth = Math.max(0.6, 0.45 * tFL[3]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tFL[0], tFL[1]); ctx.lineTo(tFR[0], tFR[1]);
    ctx.strokeStyle = 'rgba(255,250,236,0.55)'; ctx.lineWidth = Math.max(0.5, 0.35 * tFL[3]); ctx.stroke();
    // engraved octave labels on the C keys
    if (m % 12 === 0 && tFL[3] > 1.05) {
      const lp = P((x0 + x1) / 2, 14, -dzF);
      ctx.font = `${(7.2 * lp[3]).toFixed(1)}px "Old Standard TT"`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = m === 60 ? 'rgba(120,70,25,0.85)' : 'rgba(110,80,55,0.6)';
      ctx.fillText(`C${octaveOf(m)}`, lp[0], lp[1]);
    }
  }
  // Black keys.
  for (let m = LOW; m <= HIGH; m++) {
    if (!isBlack(m)) continue;
    const xc = keyX(m);
    if (xc < visL || xc > visR) continue;
    const st = state(m);
    const yb = WHITE_L - BLACK_L, yt = yb + 7;
    const dz = (y) => dipAt(st.depth, y);
    const hb = BLACK_W / 2, ht = BLACK_TOP_W / 2, H = BLACK_H;
    const base = [P(xc - hb, yb, 0.3), P(xc + hb, yb, 0.3), P(xc + hb, WHITE_L, 0.3), P(xc - hb, WHITE_L, 0.3)];
    const top = [P(xc - ht, yt, H - dz(yt)), P(xc + ht, yt, H - dz(yt)), P(xc + ht, WHITE_L, H - dz(WHITE_L)), P(xc - ht, WHITE_L, H - dz(WHITE_L))];
    // contact shadow on the white keys
    const sh = [P(xc - hb - 1.5, yb - 3, 0), P(xc + hb + 5, yb - 3, 0), P(xc + hb + 5, WHITE_L, 0), P(xc - hb - 1.5, WHITE_L, 0)];
    quad(ctx, sh); ctx.fillStyle = 'rgba(40,24,12,0.28)'; ctx.fill();
    // side facing the camera
    const left = camX < xc;
    const side = left ? [base[0], top[0], top[3], base[3]] : [base[1], top[1], top[2], base[2]];
    quad(ctx, side); ctx.fillStyle = left ? '#2b2420' : '#191412'; ctx.fill();
    // front bevel
    quad(ctx, [base[0], base[1], top[1], top[0]]);
    let g = ctx.createLinearGradient(0, base[0][1], 0, top[0][1]);
    g.addColorStop(0, '#1b1512'); g.addColorStop(1, '#5a4c44');
    ctx.fillStyle = g; ctx.fill();
    // top: ebony with a lacquer highlight
    quad(ctx, top);
    g = ctx.createLinearGradient(top[0][0], 0, top[1][0], 0);
    g.addColorStop(0, '#2c2420'); g.addColorStop(0.3, '#4e433d'); g.addColorStop(0.55, '#231c19'); g.addColorStop(1, '#120e0c');
    ctx.fillStyle = g; ctx.fill();
    g = ctx.createLinearGradient(0, top[0][1], 0, top[3][1]);
    g.addColorStop(0, 'rgba(255,240,220,0.18)'); g.addColorStop(0.25, 'rgba(255,240,220,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g; ctx.fill();
    if (st.depth > 0.01 && st.hand) {
      const C = HAND_COL[st.hand];
      const k = Math.min(1, st.depth) * (0.6 + 0.4 * st.vel);
      g = ctx.createLinearGradient(0, top[0][1], 0, top[3][1]);
      g.addColorStop(0, rgba(C.light, 0.9 * k)); g.addColorStop(0.5, rgba(C.base, 0.85 * k)); g.addColorStop(1, rgba(C.dark, 0.8 * k));
      ctx.fillStyle = g; ctx.fill();
    } else if (st.sustain > 0.01 && st.sHand) {
      const C = HAND_COL[st.sHand];
      g = ctx.createLinearGradient(0, top[3][1], 0, top[0][1]);
      g.addColorStop(0, rgba(C.base, 0.6 * st.sustain)); g.addColorStop(0.5, rgba(C.base, 0.1 * st.sustain)); g.addColorStop(1, rgba(C.base, 0));
      ctx.fillStyle = g; ctx.fill();
    }
    ctx.strokeStyle = 'rgba(10,6,4,0.9)'; ctx.lineWidth = Math.max(0.5, 0.4 * top[0][3]); ctx.stroke();
    // specular glint along the front edge
    ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); ctx.lineTo(top[1][0], top[1][1]);
    ctx.strokeStyle = 'rgba(255,236,210,0.35)'; ctx.lineWidth = Math.max(0.5, 0.5 * top[0][3]); ctx.stroke();
  }
}
