// Close-up renders of one hand for anatomy work: node tools/closeup.mjs R 40.0,41.2 [widthMM] [pitchDeg]
import { buildPerformance } from '../src/perform.js';
import { makeHandAnimator } from '../src/render/handanim.js';
import { HandRenderer, drawHandShadow } from '../src/render/handmesh.js';
import { drawKeys, drawKeySlipAndCheeks } from '../src/render/keysdraw.js';
import { makeKeyTextures } from '../src/render/textures.js';
import { keyDepthFrom } from '../src/render/handanim.js';
import { Camera } from '../src/render/camera.js';
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
const [hand = 'R', ts = '40', wmm = '300', pdeg = '52'] = process.argv.slice(2);
const perf = buildPerformance();
const keyNotes = Array.from({ length: 128 }, () => []);
for (const n of perf.notes) keyNotes[n.midi].push(n);
for (const l of keyNotes) l.sort((a, b) => a.on - b.on);
const anim = makeHandAnimator(perf, hand, keyNotes);
const W = 720, H = 720;
const cam = new Camera({ width: W, height: H, focal: 1000, cx: W / 2, cy: H * 0.55 });
const hr = new HandRenderer();
const tex = makeKeyTextures();
mkdirSync('/tmp/verify/close', { recursive: true });
for (const t of ts.split(',').map(Number)) {
  const sk = anim.skeleton(t);
  cam.set([sk.H.x, sk.H.y + 40, 10], (Number(wmm) * cam.focal) / W, (Number(pdeg) * Math.PI) / 180);
  const can = createCanvas(W, H), ctx = can.getContext('2d');
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, 0, W, H);
  drawKeySlipAndCheeks(ctx, cam);
  drawKeys(ctx, cam, (m) => ({ depth: keyDepthFrom(keyNotes[m], t), hand: null, vel: 0, sustain: 0 }), null, tex);
  hr.draw(ctx, cam, sk);
  writeFileSync(`/tmp/verify/close/${hand}-${t}.png`, can.toBuffer('image/png'));
  const f = sk.fingers;
  console.log(t, Object.keys(f).map((k) => `f${k}:${f[k].flex.map((v) => v.toFixed(2)).join('/')}${f[k].contact ? '*' : ''}`).join(' '));
}
