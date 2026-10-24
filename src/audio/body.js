// Soundboard/body coloration EQ and the (very quiet) sustain-pedal mechanism noise.
import { biquadCoefs, applyChain } from './dsp.js';
import { mulberry32 } from './rng.js';
import { NOTE_SCALE } from './piano-model.js';

export function bodyEq(L, R, fs) {
  const chain = [
    biquadCoefs('highpass', 22, 0.7, 0, fs),
    biquadCoefs('peak', 220, 0.8, 1.5, fs), // soundboard body
    biquadCoefs('peak', 650, 1.0, -1.5, fs), // de-box
    biquadCoefs('peak', 2800, 0.9, 1.2, fs), // singing presence
    biquadCoefs('highshelf', 9000, 0.7, -2.5, fs), // smooth top, sparkle without harshness
  ];
  applyChain(chain, L); applyChain(chain, R);
}

// Dampers lifting (pedal down) → soft felt swish; dampers landing (pedal up) → soft low thud.
export function addPedalNoise(L, R, pedalV, BLK, fs, seed = 0x9eda1) {
  const rng = mulberry32(seed);
  const n = L.length;
  const events = [];
  for (let b = 1; b < pedalV.length; b++) {
    if (pedalV[b - 1] < 0.5 && pedalV[b] >= 0.5) events.push([b * BLK, 'down']);
    else if (pedalV[b - 1] >= 0.5 && pedalV[b] < 0.5) events.push([b * BLK, 'up']);
  }
  for (const [t0, kind] of events) {
    const down = kind === 'down';
    const len = Math.round((down ? 0.09 : 0.045) * fs);
    const amp = NOTE_SCALE * (down ? 0.0035 : 0.005);
    const fc = down ? 900 : 140, q = down ? 0.6 : 0.9;
    const c = biquadCoefs('bandpass', fc, q, 0, fs);
    const norm = 1 / Math.sqrt(((Math.PI / 2) * (fc / q)) / (fs / 2));
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const att = Math.round(0.006 * fs), tau = (down ? 0.03 : 0.012) * fs;
    for (let k = 0; k < len && t0 + k < n; k++) {
      const x = rng() * 2 - 1;
      const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const env = (k < att ? 0.5 - 0.5 * Math.cos((Math.PI * k) / att) : Math.exp(-(k - att) / tau)) *
        (k > len - att ? 0.5 + 0.5 * Math.cos((Math.PI * (k - (len - att))) / att) : 1);
      const s = y * norm * amp * env;
      L[t0 + k] += s; R[t0 + k] += s * 0.9;
    }
  }
  return events.length;
}
