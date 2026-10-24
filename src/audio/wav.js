// WAV I/O: 24-bit PCM stereo writer with TPDF dither, and a reader for analysis.
import { writeFileSync, readFileSync } from 'node:fs';
import { mulberry32 } from './rng.js';

export function writeWav24(path, L, R, fs, ditherSeed = 0x24b17) {
  const n = L.length;
  const dataBytes = n * 6;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(fs, 24);
  buf.writeUInt32LE(fs * 6, 28);
  buf.writeUInt16LE(6, 32);
  buf.writeUInt16LE(24, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  const rnd = mulberry32(ditherSeed);
  const FS = 8388607;
  let p = 44, clipped = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const x = c === 0 ? L[i] : R[i];
      // TPDF dither of ±1 LSB at 24-bit
      let v = Math.round(x * FS + (rnd() - rnd()));
      if (v > FS) { v = FS; clipped++; } else if (v < -FS - 1) { v = -FS - 1; clipped++; }
      buf[p++] = v & 0xff; buf[p++] = (v >> 8) & 0xff; buf[p++] = (v >> 16) & 0xff;
    }
  }
  writeFileSync(path, buf);
  return { clipped };
}

export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(p + 10), fs: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    else if (id === 'data') data = { off: p + 8, len };
    p += 8 + len + (len & 1);
  }
  const { ch, fs, bits } = fmt;
  const bps = bits / 8, n = Math.floor(data.len / (bps * ch));
  const chans = Array.from({ length: ch }, () => new Float64Array(n));
  let q = data.off;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let v;
      if (bits === 24) { v = buf[q] | (buf[q + 1] << 8) | (buf[q + 2] << 16); if (v & 0x800000) v -= 0x1000000; v /= 8388608; }
      else if (bits === 16) { v = buf.readInt16LE(q) / 32768; }
      else throw new Error('unsupported bits ' + bits);
      chans[c][i] = v; q += bps;
    }
  }
  return { fs, channels: chans };
}
