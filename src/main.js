// Render pipeline: performance → synthesized audio → frames → ffmpeg → MP4.
//   node src/main.js                     full render (1080×1920, 60 fps) → out/rachmaninoff-prelude.mp4
//   node src/main.js --stills 10,70,180  PNG stills into out/stills
//   node src/main.js --from 120 --to 140 --fps 30   partial preview
//   node src/main.js --no-audio --out video.mp4 && node src/main.js --mux video.mp4   render picture, then add sound
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPerformance, toAudioJson } from './perform.js';
import { createScene } from './render/scene.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'out/';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
mkdirSync(OUT, { recursive: true });

function run(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['pipe', 'inherit', 'inherit'], ...opts });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function renderAudio(perf) {
  const json = JSON.stringify(toAudioJson(perf));
  const hash = createHash('sha1').update(json).digest('hex').slice(0, 10);
  const wav = `${OUT}audio-${hash}.wav`;
  if (existsSync(wav) && !args['force-audio']) { console.log('audio cached:', wav); return wav; }
  writeFileSync(`${OUT}performance.json`, json);
  console.log('synthesizing piano…');
  await run('node', [ROOT + 'src/audio/synth.js', `${OUT}performance.json`, wav]);
  return wav;
}

async function muxOnly(perf) {
  const audio = await masterAudio(await renderAudio(perf));
  const video = OUT + args['mux'];
  const name = args.out || 'rachmaninoff-prelude-op3-no2.mp4';
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', OUT + name]);
  console.log('muxed → out/' + name);
}

function capture(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

// Phone-friendly mastering that keeps the arc: slow RMS compression (the bell attacks pass
// untouched), then gain to -16 LUFS integrated and a gentle peak limiter.
async function masterAudio(wav) {
  const out = wav.replace(/\.wav$/, '-master.wav');
  if (existsSync(out) && !args['force-audio']) return out;
  const comp = 'acompressor=threshold=0.022:ratio=2.2:attack=150:release=1800:knee=8:detection=rms:makeup=1';
  const meas = await capture('ffmpeg', ['-hide_banner', '-i', wav, '-af', `${comp},ebur128`, '-f', 'null', '-']);
  const I = parseFloat(meas.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]);
  const gain = (-16 - I).toFixed(2);
  console.log(`mastering: ${I} LUFS after compression → gain ${gain} dB`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', `${comp},volume=${gain}dB,alimiter=limit=0.84:attack=4:release=150:level=false:asc=1`, '-c:a', 'pcm_s24le', out]);
  return out;
}

async function main() {
  const t0 = Date.now();
  const perf = buildPerformance();
  console.log(`performance: ${perf.notes.length} notes, ${perf.duration.toFixed(1)} s`);
  if (args.mux) return muxOnly(perf);
  const scene = createScene(perf);

  if (args.stills) {
    mkdirSync(OUT + 'stills', { recursive: true });
    for (const s of String(args.stills).split(',')) {
      const t = parseFloat(s);
      const c = scene.renderFrame(t, Math.round(t * 60));
      writeFileSync(`${OUT}stills/frame-${t.toFixed(2)}.png`, await c.encode('png'));
      console.log('still', t);
    }
    return;
  }

  const fps = Number(args.fps || 60);
  const totalFrames = Math.round(perf.duration * fps);
  if (Number(args.workers || 1) > 1 && args['frame-from'] === undefined) return renderParallel(perf, fps, totalFrames, Number(args.workers));
  const from = Number(args.from || 0), to = Math.min(perf.duration, Number(args.to || perf.duration));
  const f0 = args['frame-from'] !== undefined ? Number(args['frame-from']) : Math.round(from * fps);
  const f1 = args['frame-to'] !== undefined ? Number(args['frame-to']) : Math.round(to * fps);
  const audio = args['no-audio'] || args['frame-from'] !== undefined ? null : await masterAudio(await renderAudio(perf));
  const name = args.out || (from === 0 && to === perf.duration ? 'rachmaninoff-prelude-op3-no2.mp4' : `preview-${from}-${to}.mp4`);
  const ff = [
    '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${scene.W}x${scene.H}`, '-r', String(fps), '-i', '-',
    ...(audio ? ['-ss', String(from), '-t', String(to - from), '-i', audio] : []),
    '-c:v', 'libx264', '-preset', args.preset || 'faster', '-crf', String(args.crf || 18), '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-tune', 'film', '-movflags', '+faststart',
    ...(audio ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
    OUT + name,
  ];
  const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
  const frames = f1 - f0;
  let last = Date.now();
  for (let i = 0; i < frames; i++) {
    const t = (f0 + i) / fps;
    const c = scene.renderFrame(t, Math.round(t * 60));
    const buf = c.data();
    if (!enc.stdin.write(Buffer.from(buf))) await new Promise((r) => enc.stdin.once('drain', r));
    if (Date.now() - last > 15000) { last = Date.now(); console.log(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
  }
  enc.stdin.end();
  await done;
  console.log(`done → out/${name} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// Split the frames over N processes (one per core), then join the parts losslessly and add the sound.
async function renderParallel(perf, fps, totalFrames, n) {
  const t0 = Date.now();
  const audio = await masterAudio(await renderAudio(perf));
  const parts = [];
  await Promise.all(Array.from({ length: n }, (_, k) => {
    const a = Math.round((k * totalFrames) / n), b = Math.round(((k + 1) * totalFrames) / n);
    const name = `part-${k}.mp4`;
    parts.push(name);
    return run('node', [ROOT + 'src/main.js', '--frame-from', String(a), '--frame-to', String(b), '--fps', String(fps), '--out', name, ...(args.crf ? ['--crf', String(args.crf)] : []), ...(args.preset ? ['--preset', args.preset] : [])]);
  }));
  writeFileSync(OUT + 'parts.txt', parts.map((p) => `file '${OUT}${p}'`).join('\n') + '\n');
  const name = args.out || 'rachmaninoff-prelude-op3-no2.mp4';
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', OUT + 'parts.txt', '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', OUT + name]);
  console.log(`done → out/${name} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
