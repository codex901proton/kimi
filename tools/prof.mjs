import { buildPerformance } from '/tmp/hoplite/workspace/src/perform.js';
import { makeHandAnimator } from '/tmp/hoplite/workspace/src/render/handanim.js';
import { HandRenderer } from '/tmp/hoplite/workspace/src/render/handmesh.js';
import { Camera } from '/tmp/hoplite/workspace/src/render/camera.js';
import { createCanvas } from '@napi-rs/canvas';
const perf = buildPerformance();
const keyNotes = Array.from({ length: 128 }, () => []);
for (const n of perf.notes) keyNotes[n.midi].push(n);
for (const l of keyNotes) l.sort((a, b) => a.on - b.on);
const a = makeHandAnimator(perf, 'R', keyNotes);
const cam = new Camera({ width: 1080, height: 1920, focal: 1500, cx: 540, cy: 1300 });
const t = 12;
const sk0 = a.skeleton(t);
cam.set([sk0.H.x, 30, 0], 560 * 1500 / 1080, 62 * Math.PI / 180);
const hr = new HandRenderer();
const can = createCanvas(1080, 1920), ctx = can.getContext('2d');
const N = 20;
let tb = 0, tall = 0;
for (let i = 0; i < N; i++) {
  const sk = a.skeleton(t + i / 60);
  let t0 = performance.now(); hr.buildHand(sk); tb += performance.now() - t0;
  t0 = performance.now(); hr.draw(ctx, cam, sk); tall += performance.now() - t0;
}
console.log('verts', hr.nv, 'tris', hr.nt, 'build ms', (tb / N).toFixed(1), 'draw total ms', (tall / N).toFixed(1));
const acc = { raster: 0, shade: 0, seam: 0, post: 0 };
for (let i = 0; i < N; i++) { const sk = a.skeleton(t + i / 60); hr.draw(ctx, cam, sk); for (const k in acc) acc[k] += hr.prof[k] / N; }
console.log(JSON.stringify(acc), 'bbox', hr.prof.bw, hr.prof.bh);
