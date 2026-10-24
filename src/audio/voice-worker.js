// worker_threads entry: renders an assigned subset of notes into shared dry stereo buffers.
import { parentPort, workerData } from 'node:worker_threads';
import { renderNoteSet } from './voice.js';

const d = workerData;
const stats = renderNoteSet({
  ...d,
  damp: new Float32Array(d.dampSab),
  outL: new Float64Array(d.outLSab),
  outR: new Float64Array(d.outRSab),
});
parentPort.postMessage({ stats });
