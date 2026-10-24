// Procedural aged-paper textures, vignette and film-grain plates (generated once).
import { createCanvas } from '@napi-rs/canvas';
import { mulberry32 } from '../util.js';

function valueNoise2D(seed) {
  const rnd = mulberry32(seed);
  const N = 256, perm = new Uint8Array(512), vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const h = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function makePaper(W, H, seed = 7) {
  const can = createCanvas(W, H);
  const ctx = can.getContext('2d');
  const img = ctx.createImageData(W, H);
  const n1 = valueNoise2D(seed), n2 = valueNoise2D(seed + 1), n3 = valueNoise2D(seed + 2);
  const rnd = mulberry32(seed + 3);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0, a = 1, f = 1 / 260;
      for (let o = 0; o < 5; o++) { m += a * n1(x * f, y * f); a *= 0.5; f *= 2.1; }
      m /= 1.94;
      const fib = n2(x / 3.2, y / 40) * 0.6 + n2(x / 40, y / 2.6) * 0.4;   // long paper fibres
      const fine = n3(x / 1.3, y / 1.3);
      const ex = Math.min(x, W - x) / W, ey = Math.min(y, H - y) / H;
      const edge = Math.max(0, 1 - Math.min(ex * 7, ey * 9, 1)) ** 2;      // darker, foxed margins
      const laid = 0.5 + 0.5 * Math.sin(y * 0.55) ** 8;                     // laid-paper chain lines
      let k = 0.86 + (m - 0.5) * 0.17 + (fib - 0.5) * 0.045 + (fine - 0.5) * 0.03 - edge * 0.2 - laid * 0.012;
      const i = (y * W + x) * 4;
      d[i] = Math.min(255, 252 * k + 6);
      d[i + 1] = Math.min(255, 236 * k);
      d[i + 2] = Math.min(255, 204 * k - 12 * (1 - m));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Foxing spots and stains.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H, r = 2 + rnd() ** 3 * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.12;
    g.addColorStop(0, `rgba(120,72,30,${a})`);
    g.addColorStop(0.7, `rgba(140,90,40,${a * 0.5})`);
    g.addColorStop(1, 'rgba(140,90,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 6; i++) {        // faint water stains (rings)
    const x = rnd() * W, y = rnd() * H, r = 60 + rnd() * 160;
    ctx.strokeStyle = `rgba(130,85,40,${0.03 + rnd() * 0.04})`;
    ctx.lineWidth = 2 + rnd() * 5;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.7 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2); ctx.stroke();
  }
  return can;
}

export function makeVignette(W, H) {
  const can = createCanvas(W, H);
  const ctx = can.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.22, W / 2, H * 0.52, H * 0.78);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(236,214,180,1)');
  g.addColorStop(1, 'rgba(92,58,32,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return can;
}

// Grain plates at half resolution: upscaled, the grain clumps like real silver halide.
export function makeGrain(W, H, count = 6, seed = 99) {
  const plates = [];
  const rnd = mulberry32(seed);
  for (let p = 0; p < count; p++) {
    const can = createCanvas(W, H);
    const ctx = can.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < W * H; i++) {
      const g = (rnd() + rnd() + rnd() - 1.5) * 1.3;
      const v = Math.max(0, Math.min(255, 128 + g * 90));
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    plates.push(can);
  }
  return plates;
}

// Small ivory / ebony grain textures used on the keys.
export function makeKeyTextures() {
  const ivory = createCanvas(64, 256), ic = ivory.getContext('2d');
  const n = valueNoise2D(41), rnd = mulberry32(5);
  const img = ic.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const grain = n(x / 1.4, y / 30) * 0.6 + n(x / 6, y / 90) * 0.4;
    const k = 0.94 + (grain - 0.5) * 0.08 + (rnd() - 0.5) * 0.015;
    const i = (y * 64 + x) * 4;
    img.data[i] = 250 * k; img.data[i + 1] = 240 * k; img.data[i + 2] = 214 * k; img.data[i + 3] = 255;
  }
  ic.putImageData(img, 0, 0);
  const ebony = createCanvas(32, 256), ec = ebony.getContext('2d');
  const img2 = ec.createImageData(32, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 32; x++) {
    const grain = n(x / 1.2 + 50, y / 25) * 0.7 + n(x / 4 + 9, y / 70) * 0.3;
    const k = 0.75 + (grain - 0.5) * 0.5;
    const i = (y * 32 + x) * 4;
    img2.data[i] = 38 * k; img2.data[i + 1] = 30 * k; img2.data[i + 2] = 26 * k; img2.data[i + 3] = 255;
  }
  ec.putImageData(img2, 0, 0);
  return { ivory, ebony };
}
