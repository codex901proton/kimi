// Minimal Standard MIDI File (SMF) parser: returns tracks of absolute-tick events.
import { readFileSync } from 'node:fs';

export function parseMidi(path) {
  const buf = readFileSync(path);
  let p = 0;
  const u32 = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
  const u16 = () => { const v = buf.readUInt16BE(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (buf.toString('ascii', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  p = 4; const hlen = u32();
  const format = u16(), ntrk = u16(), division = u16();
  p = 8 + hlen;
  const tracks = [];
  for (let t = 0; t < ntrk; t++) {
    if (buf.toString('ascii', p, p + 4) !== 'MTrk') throw new Error('bad track');
    p += 4; const len = u32(); const end = p + len;
    let tick = 0, status = 0; const events = [];
    while (p < end) {
      tick += vlq();
      let b = buf[p];
      if (b & 0x80) { status = b; p++; }
      const type = status >> 4, ch = status & 15;
      if (status === 0xff) {
        const meta = buf[p++]; const l = vlq(); const data = buf.subarray(p, p + l); p += l;
        if (meta === 0x51) events.push({ tick, kind: 'tempo', usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (meta === 0x58) events.push({ tick, kind: 'timesig', num: data[0], den: 1 << data[1] });
        else if (meta === 0x03) events.push({ tick, kind: 'name', text: data.toString('latin1') });
        else if (meta === 0x01) events.push({ tick, kind: 'text', text: data.toString('latin1') });
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0x9 || type === 0x8) {
        const note = buf[p++], vel = buf[p++];
        events.push({ tick, kind: type === 0x9 && vel > 0 ? 'on' : 'off', ch, note, vel });
      } else if (type === 0xb) {
        const cc = buf[p++], val = buf[p++];
        events.push({ tick, kind: 'cc', ch, cc, val });
      } else if (type === 0xc || type === 0xd) { p += 1; }
      else { p += 2; }
    }
    p = end;
    tracks.push(events);
  }
  return { format, division, tracks };
}

// Pair note-on/off into notes with tick positions.
export function midiNotes(midi) {
  const notes = [];
  midi.tracks.forEach((events, track) => {
    const open = new Map();
    for (const e of events) {
      const key = e.ch * 128 + e.note;
      if (e.kind === 'on') {
        if (open.has(key)) { const n = open.get(key); n.endTick = e.tick; notes.push(n); }
        open.set(key, { track, ch: e.ch, midi: e.note, vel: e.vel, startTick: e.tick, endTick: e.tick });
      } else if (e.kind === 'off' && open.has(key)) {
        const n = open.get(key); n.endTick = e.tick; notes.push(n); open.delete(key);
      }
    }
  });
  notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
  return notes;
}
