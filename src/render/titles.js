// Title & closing cards, section titles, ornaments, the salon backdrop and the pedal lyre.
import { createCanvas } from '@napi-rs/canvas';
import { makePaper } from './textures.js';
import { clamp, smoothstep, mulberry32, noise1 } from '../util.js';

const GOLD = (a) => `rgba(232,192,112,${a})`;

// A symmetric Victorian scroll flourish centred at the origin, pointing along +x.
export function flourish(ctx, size, color, lw = 1.4) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  for (const sgn of [1, -1]) {
    ctx.save(); ctx.scale(sgn, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(size * 0.25, -size * 0.18, size * 0.5, size * 0.12, size * 0.72, 0);
    ctx.bezierCurveTo(size * 0.86, -size * 0.08, size * 0.84, -size * 0.22, size * 0.74, -size * 0.2);
    ctx.bezierCurveTo(size * 0.66, -size * 0.18, size * 0.68, -size * 0.08, size * 0.74, -size * 0.09);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size * 0.2, -size * 0.06);
    ctx.bezierCurveTo(size * 0.3, -size * 0.26, size * 0.48, -size * 0.24, size * 0.46, -size * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size * 0.3, size * 0.03);
    ctx.bezierCurveTo(size * 0.38, size * 0.18, size * 0.56, size * 0.16, size * 0.55, size * 0.06);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(size * 0.92, 0, size * 0.05, size * 0.025, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.moveTo(0, -size * 0.07); ctx.lineTo(size * 0.04, 0); ctx.lineTo(0, size * 0.07); ctx.lineTo(-size * 0.04, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function corner(ctx, x, y, sx, sy, s, color, lw) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, s); ctx.bezierCurveTo(0, s * 0.4, s * 0.1, s * 0.1, s * 0.45, s * 0.12);
  ctx.bezierCurveTo(s * 0.7, s * 0.14, s * 0.62, s * 0.42, s * 0.42, s * 0.36);
  ctx.bezierCurveTo(s * 0.3, s * 0.32, s * 0.36, s * 0.22, s * 0.44, s * 0.25);
  ctx.moveTo(s, 0); ctx.bezierCurveTo(s * 0.4, 0, s * 0.1, s * 0.1, s * 0.12, s * 0.45);
  ctx.bezierCurveTo(s * 0.14, s * 0.7, s * 0.42, s * 0.62, s * 0.36, s * 0.42);
  ctx.moveTo(s * 0.2, s * 0.2); ctx.bezierCurveTo(s * 0.5, s * 0.5, s * 0.8, s * 0.55, s * 1.1, s * 0.5);
  ctx.moveTo(s * 0.2, s * 0.2); ctx.bezierCurveTo(s * 0.5, s * 0.5, s * 0.55, s * 0.8, s * 0.5, s * 1.1);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(s * 0.2, s * 0.2, s * 0.04, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

export function drawFrame(ctx, W, H, inset, color, lw, cs) {
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
  ctx.lineWidth = lw * 0.5;
  ctx.strokeRect(inset + 7, inset + 7, W - 2 * inset - 14, H - 2 * inset - 14);
  for (const [x, y, sx, sy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]) corner(ctx, x, y, sx, sy, cs, color, lw);
}

function damaskTile() {
  const c = createCanvas(150, 210), x = c.getContext('2d');
  x.strokeStyle = 'rgba(232,192,112,1)'; x.fillStyle = 'rgba(232,192,112,1)'; x.lineWidth = 1.6;
  const motif = (cx, cy, s) => {
    x.save(); x.translate(cx, cy); x.scale(s, s);
    for (const sg of [1, -1]) {
      x.save(); x.scale(sg, 1);
      x.beginPath(); x.moveTo(0, 40); x.bezierCurveTo(30, 20, 34, -10, 10, -30); x.bezierCurveTo(4, -36, 0, -46, 0, -56); x.stroke();
      x.beginPath(); x.moveTo(4, 10); x.bezierCurveTo(26, 4, 30, -14, 18, -16); x.bezierCurveTo(10, -16, 12, -6, 18, -8); x.stroke();
      x.beginPath(); x.moveTo(2, 40); x.bezierCurveTo(14, 46, 26, 56, 22, 66); x.stroke();
      x.restore();
    }
    x.beginPath(); x.ellipse(0, -8, 5, 12, 0, 0, Math.PI * 2); x.fill();
    x.restore();
  };
  motif(75, 105, 1.05); motif(0, 0, 0.55); motif(150, 0, 0.55); motif(0, 210, 0.55); motif(150, 210, 0.55);
  return c;
}

export function makeSalon(W, H, keyY) {
  const can = createCanvas(W, H), ctx = can.getContext('2d');
  let g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e0805'); g.addColorStop(0.35, '#1d120a'); g.addColorStop(keyY / H, '#3a2414'); g.addColorStop(Math.min(1, keyY / H + 0.08), '#22140b'); g.addColorStop(1, '#100905');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // damask wallpaper, fading toward the lamp light
  const pat = ctx.createPattern(damaskTile(), 'repeat');
  ctx.globalAlpha = 0.045; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, keyY - 150); ctx.globalAlpha = 1;
  // pool of lamp light on the keyboard
  g = ctx.createRadialGradient(W / 2, keyY - 60, 20, W / 2, keyY - 60, H * 0.62);
  g.addColorStop(0, 'rgba(255,196,120,0.30)'); g.addColorStop(0.4, 'rgba(240,160,90,0.12)'); g.addColorStop(1, 'rgba(240,160,90,0)');
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // aged print texture
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.55;
  ctx.drawImage(makePaper(W, H, 21), 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return can;
}

export function makeOverlay(W, H, fonts) {
  const can = createCanvas(W, H), ctx = can.getContext('2d');
  drawFrame(ctx, W, H, 22, GOLD(0.5), 1.6, 70);
  ctx.font = '25px "Playfair Display SC"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = GOLD(0.72);
  ctx.fillText('С. В. Рахманинов  ·  Прелюдия до-диез минор', W / 2, 74);
  ctx.save(); ctx.translate(W / 2, 108); flourish(ctx, 150, GOLD(0.55), 1.3); ctx.restore();
  return can;
}

function paperCard(W, H) {
  const can = createCanvas(W, H), ctx = can.getContext('2d');
  ctx.drawImage(makePaper(W, H, 3), 0, 0);
  return can;
}

function revealText(ctx, text, x, y, k) {
  // ink "write-on": the text appears from left to right with a soft edge
  if (k <= 0) return;
  if (k >= 1) { ctx.fillText(text, x, y); return; }
  const w = ctx.measureText(text).width;
  const left = ctx.textAlign === 'center' ? x - w / 2 : x;
  ctx.save();
  const edge = left + (w + 80) * k;
  ctx.beginPath(); ctx.rect(left - 40, y - 400, edge - left + 40, 800); ctx.clip();
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function makeCards(W, H) {
  return { paper: paperCard(W, H) };
}

const INK = (a) => `rgba(52,30,16,${a})`;

export function drawTitleCard(ctx, W, H, t, cards, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(cards.paper, 0, 0);
  drawFrame(ctx, W, H, 44, INK(0.75), 2.2, 120);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const k = (a, d = 0.7) => smoothstep((t - a * 0.75) / d);
  ctx.fillStyle = INK(0.85);
  ctx.font = '30px "Playfair Display SC"';
  revealText(ctx, 'MORCEAUX DE FANTAISIE  ·  OP. 3', W / 2, 470, k(0.5));
  ctx.save(); ctx.translate(W / 2, 530); ctx.globalAlpha = alpha * k(0.8); flourish(ctx, 220, INK(0.8), 2); ctx.restore();
  ctx.fillStyle = INK(0.95);
  ctx.font = 'bold 128px "Playfair Display SC"';
  revealText(ctx, 'Прелюдия', W / 2, 720, k(1.0, 1.1));
  ctx.font = 'italic 64px "Old Standard TT"';
  revealText(ctx, 'до-диез минор', W / 2, 820, k(1.5));
  ctx.fillStyle = INK(0.8);
  ctx.font = '74px "Pinyon Script"';
  revealText(ctx, 'Prélude en ut dièse mineur', W / 2, 950, k(1.9, 1.1));
  ctx.save(); ctx.translate(W / 2, 1050); ctx.globalAlpha = alpha * k(2.2); flourish(ctx, 300, INK(0.8), 2.2); ctx.restore();
  ctx.fillStyle = INK(0.92);
  ctx.font = '62px "Old Standard TT"';
  revealText(ctx, 'Сергей Рахманинов', W / 2, 1200, k(2.4));
  ctx.font = '44px "Old Standard TT"';
  revealText(ctx, '1892', W / 2, 1280, k(2.7));
  ctx.font = 'italic 34px "Old Standard TT"';
  ctx.fillStyle = INK(0.7);
  revealText(ctx, 'Посвящается Антону Аренскому', W / 2, 1470, k(2.9));
  ctx.restore();
}

export function drawEndCard(ctx, W, H, t, cards, alpha, credit) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(cards.paper, 0, 0);
  drawFrame(ctx, W, H, 44, INK(0.75), 2.2, 120);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK(0.92);
  ctx.font = '230px "Pinyon Script"';
  ctx.fillText('Fin', W / 2, 760);
  ctx.save(); ctx.translate(W / 2, 860); flourish(ctx, 300, INK(0.8), 2.2); ctx.restore();
  ctx.font = '50px "Old Standard TT"';
  ctx.fillText('Сергей Рахманинов', W / 2, 1010);
  ctx.font = 'italic 40px "Old Standard TT"';
  ctx.fillText('Прелюдия до-диез минор, соч. 3 № 2', W / 2, 1075);
  ctx.font = '30px "Old Standard TT"';
  ctx.fillStyle = INK(0.7);
  credit.forEach((line, i) => ctx.fillText(line, W / 2, 1420 + i * 46));
  ctx.restore();
}

export function drawIris(ctx, W, H, k) {
  // silent-film iris: k = 1 fully open, 0 closed
  if (k >= 1) return;
  const r = Math.hypot(W, H) * 0.55 * k;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, Math.max(0.1, r), 0, Math.PI * 2, true);
  ctx.fillStyle = '#080503'; ctx.fill('evenodd');
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.max(0, r - 60), W / 2, H / 2, r + 1);
  g.addColorStop(0, 'rgba(8,5,3,0)'); g.addColorStop(1, 'rgba(8,5,3,0.9)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, H / 2, r + 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Opening title over the scene while the first bells sound.
export function drawOpeningTitle(ctx, W, t) {
  const a = smoothstep((t - 0.4) / 0.9) * (1 - smoothstep((t - 6.2) / 1.4));
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 14;
  ctx.fillStyle = GOLD(0.96);
  ctx.font = '108px "Pinyon Script"';
  ctx.fillText('Прелюдия', W / 2, 330 - 8 * (1 - a));
  ctx.font = 'italic 50px "Old Standard TT"';
  ctx.fillText('до-диез минор, соч. 3 № 2', W / 2, 400);
  ctx.font = '40px "Playfair Display SC"';
  ctx.fillText('Сергей Рахманинов · 1892', W / 2, 470);
  ctx.shadowBlur = 0;
  ctx.translate(W / 2, 510);
  flourish(ctx, 220, GOLD(0.8), 1.6);
  ctx.restore();
}

export function drawSectionTitle(ctx, W, sec, t) {
  const dt = t - sec.t;
  if (dt < -0.2 || dt > 4.2) return;
  const a = smoothstep((dt + 0.2) / 0.8) * (1 - smoothstep((dt - 3.0) / 1.2));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '104px "Pinyon Script"';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
  ctx.fillStyle = GOLD(0.95);
  ctx.fillText(sec.title, W / 2, 300 - 10 * (1 - a));
  if (sec.subtitle) { ctx.font = 'italic 42px "Old Standard TT"'; ctx.fillText(sec.subtitle, W / 2, 360); }
  ctx.shadowBlur = 0;
  ctx.translate(W / 2, sec.subtitle ? 400 : 345);
  flourish(ctx, 190 * (0.6 + 0.4 * a), GOLD(0.8), 1.6);
  ctx.restore();
}

// Lyre with three brass pedals; the right (damper) pedal follows the sustain pedal.
export function drawPedalLyre(ctx, x, y, pedal, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.92;
  // lyre rods
  ctx.strokeStyle = '#3a2214'; ctx.lineWidth = 7;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * 18, -78); ctx.bezierCurveTo(s * 46, -58, s * 8, -30, s * 30, -6); ctx.stroke();
  }
  ctx.strokeStyle = '#c9963f'; ctx.lineWidth = 2;
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(s * 18, -78); ctx.bezierCurveTo(s * 46, -58, s * 8, -30, s * 30, -6); ctx.stroke();
  }
  // pedal box
  const bg = ctx.createLinearGradient(0, -10, 0, 14);
  bg.addColorStop(0, '#6b3a20'); bg.addColorStop(1, '#2a140a');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.moveTo(-70, -8); ctx.lineTo(70, -8); ctx.lineTo(62, 14); ctx.lineTo(-62, 14); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(232,192,112,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
  const pedals = [[-34, 0], [0, 0], [34, pedal]];
  for (const [px, v] of pedals) {
    ctx.save(); ctx.translate(px, 6); ctx.rotate(0.28 * v);
    const pg = ctx.createLinearGradient(0, 0, 0, 30);
    pg.addColorStop(0, '#f6dc96'); pg.addColorStop(0.5, '#c58e33'); pg.addColorStop(1, '#6e4614');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(9, 26); ctx.quadraticCurveTo(0, 32, -9, 26); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a220c'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  if (pedal > 0.02) {
    ctx.globalAlpha = 0.95 * pedal;
    ctx.font = '40px "Pinyon Script"'; ctx.textAlign = 'center';
    ctx.fillStyle = GOLD(1);
    ctx.fillText('Ped.', 52, -40);
  }
  ctx.restore();
}
