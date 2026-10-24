// Frame composition: camera direction, layer order, key states, effects.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { Camera } from './camera.js';
import { makeVignette, makeGrain, makeKeyTextures } from './textures.js';
import { makeSalon, makeOverlay, makeCards, drawEndCard, drawIris, drawSectionTitle, drawOpeningTitle, drawPedalLyre } from './titles.js';
import { drawKeys, drawKeySlipAndCheeks, HAND_COL } from './keysdraw.js';
import { drawLanes, drawNotes, visibleLength, hwPoint } from './notesdraw.js';
import { drawImpacts, drawEmbers, drawFlyingGlyphs, drawRays, drawFlash, drawFilm } from './fx.js';
import { makeHandAnimator, keyDepthFrom } from './handanim.js';
import { HandRenderer, drawHandShadow, drawContactShadows } from './handmesh.js';
import { pedalAt } from '../pedal.js';
import { keyX, KEYBOARD_W } from '../keyboard.js';
import { barBeat } from '../score.js';
import { INTRO } from '../perform.js';
import { clamp, smoothstep, minjerk, noise1, lerp, lowerBound } from '../util.js';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
export function registerFonts() {
  for (const [f, fam] of [
    ['OldStandard-Regular.ttf', 'Old Standard TT'], ['OldStandard-Italic.ttf', 'Old Standard TT'], ['OldStandard-Bold.ttf', 'Old Standard TT'],
    ['PinyonScript-Regular.ttf', 'Pinyon Script'], ['PlayfairDisplaySC-Regular.ttf', 'Playfair Display SC'], ['PlayfairDisplaySC-Bold.ttf', 'Playfair Display SC'],
  ]) GlobalFonts.registerFromPath(FONT_DIR + f, fam);
}

const W = 1080, H = 1920, KEY_Y = 1470;
const CAM_DT = 1 / 30;

function gaussianSmooth(arr, sigmaSamples) {
  const r = Math.ceil(sigmaSamples * 3), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigmaSamples * sigmaSamples)));
  return arr.map((_, i) => {
    let s = 0, w = 0;
    for (let j = -r; j <= r; j++) { const v = arr[Math.min(arr.length - 1, Math.max(0, i + j))]; s += v * k[j + r]; w += k[j + r]; }
    return s / w;
  });
}

export function createScene(perf) {
  registerFonts();
  const notes = perf.notes;
  const pedalPts = perf.pedal.points;
  // How long each string keeps sounding after the key comes up (until the dampers fall).
  for (const n of notes) {
    let t = n.keyUp;
    const natural = n.on + clamp(10 - 0.1 * (n.midi - 21), 1.6, 10);
    if (n.midi <= 89) { while (t < natural && pedalAt(pedalPts, t) > 0.5) t += 0.01; } else t = natural;
    n.soundEnd = Math.max(n.keyUp, Math.min(t, natural));
  }
  const keyNotes = Array.from({ length: 128 }, () => []);
  for (const n of notes) keyNotes[n.midi].push(n);
  for (const l of keyNotes) l.sort((a, b) => a.on - b.on);
  const notesByOn = notes.slice().sort((a, b) => a.on - b.on);
  // Flying glyphs: one per voiced gesture (bells, theme, melody, big chords).
  const glyphNotes = [];
  const lastG = { R: -9, L: -9 };
  for (const n of notesByOn) {
    const strong = (['bell', 'theme', 'melody'].includes(n.role) && n.vel > 0.3) || n.vel > 0.82;
    if (!strong || n.on - lastG[n.hand] < 0.3) continue;
    lastG[n.hand] = n.on;
    glyphNotes.push(n);
  }
  const anim = { L: makeHandAnimator(perf, 'L', keyNotes), R: makeHandAnimator(perf, 'R', keyNotes) };
  const tm = perf.timeMap;
  const shocks = [barBeat(44), barBeat(45), barBeat(46), barBeat(47), barBeat(50)].map((b) => ({ t: tm.beatToTime(b), k: b === barBeat(47) || b === barBeat(50) ? 1 : 0.75 }));

  // ---- camera direction: anticipatory framing of the next couple of seconds ----
  const nS = Math.ceil(perf.duration / CAM_DT) + 1;
  const cx = new Array(nS), wd = new Array(nS), look = new Array(nS), energy = new Array(nS);
  let pc = 611, pw = 900;
  for (let i = 0; i < nS; i++) {
    const t = i * CAM_DT;
    let lo = Infinity, hi = -Infinity;
    const a = lowerBound(notesByOn, t - 0.6, (n) => n.on);
    for (let j = a; j < notesByOn.length && notesByOn[j].on < t + 2.2; j++) {
      const x = keyX(notesByOn[j].midi);
      if (x < lo) lo = x; if (x > hi) hi = x;
    }
    for (const h of ['L', 'R']) { const p = anim[h].pose(t); if (p.alpha > 0.5) { lo = Math.min(lo, p.x - 115); hi = Math.max(hi, p.x + 115); } }
    if (lo < hi) { pc = (lo + hi) / 2; pw = hi - lo + 120; }
    cx[i] = pc; wd[i] = Math.log(clamp(pw, 420, 1000));
    const bpm = tm.bpm(tm.timeToBeat(t));
    look[i] = clamp((3.4 * 60) / bpm, 1.75, 3.3);
    let e = 0;
    for (let j = lowerBound(notesByOn, t - 2.5, (n) => n.on); j < notesByOn.length && notesByOn[j].on <= t; j++) {
      const n = notesByOn[j];
      e += n.vel ** 3 * Math.exp(-(t - n.on) / 0.9);
    }
    energy[i] = e;
  }
  // widen early enough for leaps (running max), then smooth
  const wmax = wd.map((_, i) => { let m = -Infinity; for (let j = i - 30; j <= i + 36; j++) m = Math.max(m, wd[Math.min(nS - 1, Math.max(0, j))]); return m; });
  const camX = gaussianSmooth(cx, 26), camW = gaussianSmooth(wmax, 24).map(Math.exp), camLook = gaussianSmooth(look, 40);
  const eMax = Math.max(...energy);
  const camE = gaussianSmooth(energy.map((e) => clamp(e / (eMax * 0.55))), 12);
  const sample = (arr, t) => { const x = clamp(t / CAM_DT, 0, nS - 1); const i = Math.floor(x); const f = x - i; return arr[i] + (arr[Math.min(nS - 1, i + 1)] - arr[i]) * f; };

  const cam = new Camera({ width: W, height: H, focal: 1500, cx: W / 2, cy: KEY_Y });
  const handR = new HandRenderer();
  const tex = makeKeyTextures();
  const plates = { vignette: makeVignette(W, H), grain: makeGrain(W / 2, H / 2, 6) };
  const salon = makeSalon(W, H, KEY_Y);
  const overlay = makeOverlay(W, H);
  const cards = makeCards(W, H);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const shadowCan = createCanvas(W / 2, H / 2);
  const sctx = shadowCan.getContext('2d');
  const credit = [
    'Нотный текст: Mutopia Project · набор Petro Kostandy · CC BY-SA 4.0',
    'Изображение, движение рук и звук рояля синтезированы кодом',
  ];
  const firstOn = notesByOn[0].on;

  function setCamera(t) {
    let x = sample(camX, t), w = sample(camW, t);
    let pitch = (62 - 3 * sample(camE, t)) * Math.PI / 180;
    // establishing move: settle down onto the hands as they rise into place
    const intro = minjerk(t / (INTRO + 0.6));
    pitch = lerp(68 * Math.PI / 180, pitch, intro);
    w = lerp(w * 1.25, w, intro);
    // closing: drift back and up as the last chord dies away
    const out = minjerk((t - (perf.musicEnd - 3)) / 4);
    w = lerp(w, w * 1.3, out); pitch = lerp(pitch, 66 * Math.PI / 180, out);
    x = clamp(x, w / 2 - 80, KEYBOARD_W - w / 2 + 80);
    if (w > KEYBOARD_W + 100) x = KEYBOARD_W / 2;
    let shake = 0;
    for (const s of shocks) if (t >= s.t && t < s.t + 0.8) shake += s.k * Math.exp(-(t - s.t) / 0.16);
    const sx = 3.2 * shake * noise1(t * 38, 1), sz = 2.4 * shake * noise1(t * 41, 2);
    x += 2.5 * noise1(t * 0.13, 40);
    const dist = (w * cam.focal) / W;
    cam.set([x + sx, 10, sz], dist, pitch, 0.012 * noise1(t * 0.09, 41), 0.004 * shake * noise1(t * 30, 3));
    return { shake };
  }

  function keyState(t) {
    return (m) => {
      const list = keyNotes[m];
      const depth = list.length ? keyDepthFrom(list, t) : 0;
      let hand = null, vel = 0, sustain = 0, sHand = null;
      const i = lowerBound(list, t + 1e-6, (n) => n.tContact) - 1;
      if (i >= 0) {
        const n = list[i];
        if (t <= n.keyUp + 0.09) { hand = n.hand; vel = n.vel; }
        else if (t < n.soundEnd) {
          sHand = n.hand;
          sustain = Math.exp(-(t - n.keyUp) / (1.2 + 3 * (1 - (n.midi - 21) / 87))) * (1 - smoothstep((t - n.soundEnd + 0.12) / 0.12)) * (0.4 + 0.6 * n.vel);
        }
      }
      return { depth, hand, vel, sustain, sHand };
    };
  }

  function renderFrame(t, frame) {
    const { shake } = setCamera(t);
    const sVis = visibleLength(cam);
    const lookahead = sample(camLook, t);
    const view = { sVis, speed: sVis / lookahead, xL: cam.unprojectToZ(0, KEY_Y, 0)[0], xR: cam.unprojectToZ(W, KEY_Y, 0)[0] };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0.5 * noise1(t * 9, 61), 0.7 * noise1(t * 7, 62)); // gate weave
    ctx.drawImage(salon, -2, -2, W + 4, H + 4);
    drawRays(ctx, W, H, t, sample(camE, t) * smoothstep((t - INTRO) / 2));
    drawLanes(ctx, cam, view, t, perf.bars, perf.markings);
    drawNotes(ctx, cam, view, t, notes);
    // fog: the far end of the highway melts into the dark
    const fg = ctx.createLinearGradient(0, 0, 0, 520);
    fg.addColorStop(0, 'rgba(14,8,5,0.92)'); fg.addColorStop(1, 'rgba(14,8,5,0)');
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, 520);
    drawKeySlipAndCheeks(ctx, cam);
    const st = keyState(t);
    drawKeys(ctx, cam, st, null, tex);
    const sk = { L: anim.L.skeleton(t), R: anim.R.skeleton(t) };
    // soft cast shadows of the hands on the keys
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, W / 2, H / 2);
    sctx.fillStyle = 'rgba(0,0,0,1)';
    drawHandShadow(sctx, cam, sk.L, 0.5); drawHandShadow(sctx, cam, sk.R, 0.5);
    ctx.save();
    { // the shadow falls on the keys only
      const q = [[-10, 0], [KEYBOARD_W + 10, 0], [KEYBOARD_W + 10, 160], [-10, 160]].map(([x, y]) => cam.project([x, y, 0]));
      ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip();
    }
    ctx.globalAlpha = 0.4; ctx.globalCompositeOperation = 'multiply';
    ctx.filter = 'blur(6px)';
    ctx.drawImage(shadowCan, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.restore();
    drawContactShadows(ctx, cam, sk.L); drawContactShadows(ctx, cam, sk.R);
    const held = [];
    for (let j = lowerBound(notesByOn, t - 12, (n) => n.on); j < notesByOn.length && notesByOn[j].on <= t; j++) if (notesByOn[j].keyUp >= t) held.push(notesByOn[j]);
    drawEmbers(ctx, cam, t, held);
    drawImpacts(ctx, cam, t, notesByOn);
    drawFlyingGlyphs(ctx, cam, t, glyphNotes);
    const order = cam.depth(sk.L.wrist) > cam.depth(sk.R.wrist) ? ['L', 'R'] : ['R', 'L'];
    for (const h of order) handR.draw(ctx, cam, sk[h]);
    for (const s of shocks) if (t >= s.t && t < s.t + 1.2) drawFlash(ctx, W, H, W / 2, KEY_Y - 120, s.k * Math.exp(-(t - s.t) / 0.22), [255, 214, 150]);
    drawPedalLyre(ctx, W / 2, H - 92, pedalAt(pedalPts, t) * smoothstep((t - firstOn + 1) / 1), t);
    drawOpeningTitle(ctx, W, t);
    for (const sec of perf.sections) if (sec.beat > 0) drawSectionTitle(ctx, W, sec, t);
    ctx.drawImage(overlay, 0, 0);
    ctx.restore();
    drawFilm(ctx, W, H, t, frame, plates);
    // closing card with a silent-film iris
    const endA = smoothstep((t - (perf.musicEnd - 0.5)) / 1.0);
    drawEndCard(ctx, W, H, t, cards, endA, credit);
    if (endA > 0) drawFilm(ctx, W, H, t, frame + 7, plates);
    drawIris(ctx, W, H, Math.min(minjerk(t / 0.8), 1 - minjerk((t - (perf.duration - 0.8)) / 0.75)));
    return canvas;
  }

  return { renderFrame, canvas, W, H };
}
