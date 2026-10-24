// Consecutive frames → contact sheet of the hand region: node tools/seq.mjs <t0> <n> <dt> <name>
import { buildPerformance } from '../src/perform.js';
import { createScene } from '../src/render/scene.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const [t0, n, dt] = process.argv.slice(2, 5).map(Number), name = process.argv[5] || 'seq';
const perf = buildPerformance();
const sc = createScene(perf);
mkdirSync('/tmp/seq', { recursive: true });
for (let i = 0; i < n; i++) { const t = t0 + i * dt; writeFileSync(`/tmp/seq/${name}-${String(i).padStart(3, '0')}.png`, await sc.renderFrame(t, Math.round(t * 60)).encode('png')); }
